import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex, crossDomain } from '@convex-dev/better-auth/plugins';
import { betterAuth } from 'better-auth/minimal';
import { bearer } from 'better-auth/plugins/bearer';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { query } from './_generated/server';
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
    emailAndPassword: { enabled: false },
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    socialProviders:
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
              prompt: 'select_account',
              accessType: 'online',
            },
          }
        : {},
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    // The library handles Google's authorization-code flow and the redirect/session
    // handoff to identity.launchWebAuthFlow. No device enrollment credentials exist.
    plugins: [
      crossDomain({ siteUrl: process.env.CONVEX_SITE_URL! }),
      bearer(),
      convex({ authConfig }),
    ],
  });
export const configuration = query({
  args: {},
  handler: () => ({
    googleConfigured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    firefoxLaunchSupported: true,
  }),
});
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    return { id: user._id, email: user.email, name: user.name };
  },
});
