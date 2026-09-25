import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { betterAuth } from 'better-auth/minimal';
import { bearer } from 'better-auth/plugins/bearer';
import { ConvexError, v } from 'convex/values';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { internalAction, query } from './_generated/server';
import authConfig from './auth.config';

export const authComponent = createClient<DataModel>(components.betterAuth);
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    trustedOrigins: (process.env.AUTH_TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
    // Better Auth only enables this when NODE_ENV is "production", which Convex never sets.
    // Counters live in the component's rateLimit table so every isolate shares them.
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: {
        '/sign-in/email': { window: 300, max: 10 },
        '/sign-up/email': { window: 3600, max: 5 },
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
// Operator-only (`npx convex run auth:setPassword`): there is no self-service reset, and
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
