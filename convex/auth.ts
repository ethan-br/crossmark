import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { betterAuth } from 'better-auth/minimal';
import { bearer } from 'better-auth/plugins/bearer';
import { ConvexError, v } from 'convex/values';
import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { internalAction, query } from './_generated/server';
import authConfig from './auth.config';

export const authComponent = createClient<DataModel>(components.betterAuth, {
  // A function reference avoids the generated API/type cycle through this trigger.
  authFunctions: {
    onDelete: makeFunctionReference('auth:onDelete') as unknown as FunctionReference<
      'mutation',
      'internal'
    >,
  },
  triggers: {
    user: {
      onDelete: async (ctx, user) => {
        const collections = await ctx.db
          .query('collections')
          .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
          .collect();
        for (const collection of collections) {
          for (const table of ['operations', 'backups', 'devices'] as const) {
            const rows = await ctx.db
              .query(table)
              .withIndex('by_collection', (q) => q.eq('collectionId', collection._id))
              .collect();
            for (const row of rows) await ctx.db.delete(row._id);
          }
          await ctx.db.delete(collection._id);
        }
      },
    },
  },
});
export const { onDelete } = authComponent.triggersApi();
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    trustedOrigins: (process.env.AUTH_TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 1800,
      ...(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM
        ? {
            sendResetPassword: async ({
              user,
              token,
            }: {
              user: { email: string };
              token: string;
            }) => {
              const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  from: process.env.AUTH_EMAIL_FROM,
                  to: [user.email],
                  subject: 'Reset your Crossmark password',
                  text: `Paste this reset code into Crossmark: ${token}\n\nIt expires in 30 minutes. If you did not request this, ignore this email.`,
                }),
              });
              if (!response.ok) throw new Error('Password reset email delivery failed.');
            },
          }
        : {}),
    },
    user: { deleteUser: { enabled: true } },
    hooks: {
      before: createAuthMiddleware(async (request) => {
        if (request.path === '/delete-user' && !request.body?.password)
          throw new APIError('BAD_REQUEST', {
            message: 'Enter your password and confirm account deletion.',
          });
      }),
    },
    // Better Auth only enables this when NODE_ENV is "production", which Convex never sets.
    // Counters live in the component's rateLimit table so every isolate shares them.
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: {
        '/sign-in/email': { window: 300, max: 10 },
        '/sign-up/email': { window: 3600, max: 5 },
        '/request-password-reset': { window: 3600, max: 5 },
        '/reset-password': { window: 300, max: 10 },
        '/delete-user': { window: 300, max: 5 },
      },
    },
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    // The extension keeps the bearer session token; no cookies or device enrollment credentials exist.
    plugins: [bearer(), convex({ authConfig })],
  });
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    return { id: user._id, email: user.email, name: user.name };
  },
});
// Operator-only (`npx convex run auth:setPassword`): also supports legacy accounts;
// accounts created through Google sign-in have no password until this sets one. Ends every session.
export const setPassword = internalAction({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }) => {
    const auth = await createAuth(ctx).$context;
    const { minPasswordLength, maxPasswordLength } = auth.password.config;
    if (password.length < minPasswordLength || password.length > maxPasswordLength)
      throw new ConvexError(
        `Use a password between ${minPasswordLength} and ${maxPasswordLength} characters.`,
      );
    const found = await auth.internalAdapter.findUserByEmail(email.trim().toLowerCase(), {
      includeAccounts: true,
    });
    if (!found) throw new ConvexError('No account uses this email.');
    const hash = await auth.password.hash(password);
    if (found.accounts.some((a) => a.providerId === 'credential'))
      await auth.internalAdapter.updatePassword(found.user.id, hash);
    else
      await auth.internalAdapter.linkAccount({
        userId: found.user.id,
        providerId: 'credential',
        accountId: found.user.id,
        password: hash,
      });
    await auth.internalAdapter.deleteUserSessions(found.user.id);
  },
});
