import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authenticatedBackend } from './fixtures/auth';
const origin = 'chrome-extension://eblopgfhjccjncfjmgcjfahaggkcolok';
beforeEach(() => {
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-with-at-least-thirty-two-characters');
  vi.stubEnv('AUTH_TRUSTED_ORIGINS', origin);
});
afterEach(() => vi.unstubAllEnvs());
type Backend = Awaited<ReturnType<typeof authenticatedBackend>>['unauthenticated'];
function request(t: Backend, path: string, body: unknown, requestOrigin = origin) {
  return t.fetch(`/api/auth${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: requestOrigin,
      Cookie: 'origin-check=1',
    },
    body: JSON.stringify(body),
  });
}
const account = { email: 'user@example.com', name: 'user', password: 'password1234' };
it('signs up, signs in and issues a Convex token through the real Better Auth routes', async () => {
  const { unauthenticated: t } = await authenticatedBackend();
  const signUp = await request(t, '/sign-up/email', account);
  expect(signUp.status).toBe(200);
  expect(signUp.headers.get('set-auth-token')).toBeTruthy();
  const signIn = await request(t, '/sign-in/email', {
    email: account.email,
    password: account.password,
  });
  expect(signIn.status).toBe(200);
  const token = signIn.headers.get('set-auth-token');
  expect(token).toBeTruthy();
  const jwt = await t.fetch('/api/auth/convex/token', {
    headers: { Authorization: `Bearer ${token}`, Origin: origin },
  });
  expect(jwt.status).toBe(200);
  expect((await jwt.json()).token).toBeTruthy();
});
it('rejects wrong passwords, duplicate accounts and short passwords', async () => {
  const { unauthenticated: t } = await authenticatedBackend();
  expect((await request(t, '/sign-up/email', account)).status).toBe(200);
  expect(
    (await request(t, '/sign-in/email', { email: account.email, password: 'wrong-password' }))
      .status,
  ).toBe(401);
  expect((await request(t, '/sign-up/email', account)).status).toBeGreaterThanOrEqual(400);
  expect(
    (
      await request(t, '/sign-up/email', {
        ...account,
        email: 'other@example.com',
        password: 'short',
      })
    ).status,
  ).toBe(400);
});
it('rejects untrusted cookie-bearing origins', async () => {
  const { unauthenticated: t } = await authenticatedBackend();
  expect((await request(t, '/sign-up/email', account, 'https://attacker.example')).status).toBe(
    403,
  );
});
it('no longer offers Google login or session handoffs', async () => {
  const { unauthenticated: t } = await authenticatedBackend();
  expect(
    (await request(t, '/sign-in/social', { provider: 'google', disableRedirect: true })).status,
  ).toBeGreaterThanOrEqual(400);
  expect(
    (await request(t, '/cross-domain/one-time-token/verify', { token: 'invented' })).status,
  ).toBeGreaterThanOrEqual(400);
  expect((await t.fetch('/extension/google-launch')).status).toBe(404);
});
