import { convexTest } from 'convex-test';
import betterAuth from '@convex-dev/better-auth/test';
import schema from '../../convex/schema';
import { components } from '../../convex/_generated/api';
const modules = import.meta.glob('../../convex/**/*.ts');
export async function authenticatedBackend() {
  const unauthenticated = convexTest(schema, modules);
  betterAuth.register(unauthenticated);
  async function account(email = 'test@example.com', expiresAt = Date.now() + 86400000) {
    const user = await unauthenticated.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'user',
          data: {
            name: 'Test user',
            email,
            emailVerified: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      }),
    );
    const session = await unauthenticated.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'session',
          data: {
            userId: user._id,
            token: crypto.randomUUID(),
            expiresAt,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      }),
    );
    const t = unauthenticated.withIdentity({ subject: user._id, sessionId: session._id });
    const auth = {
      signIn: async () => ({ id: user._id, email, name: 'Test user' }),
      token: async () => 'test-session-jwt',
      signOut: async () => {},
    };
    return { t, auth };
  }
  return { unauthenticated, account, ...(await account()) };
}
