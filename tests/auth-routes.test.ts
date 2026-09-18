import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authenticatedBackend } from './fixtures/auth';
const origin = 'chrome-extension://eblopgfhjccjncfjmgcjfahaggkcolok';
const callback =
  'https://eblopgfhjccjncfjmgcjfahaggkcolok.chromiumapp.org/auth?state=extension-nonce';
beforeEach(() => {
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-with-at-least-thirty-two-characters');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'test-only.apps.googleusercontent.com');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-only-google-secret');
  vi.stubEnv('AUTH_TRUSTED_ORIGINS', `${origin},${new URL(callback).origin}`);
});
afterEach(() => vi.unstubAllEnvs());
async function request(path: string, body: unknown, requestOrigin = origin) {
  const { unauthenticated: t } = await authenticatedBackend();
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
it('starts Google OAuth through the real Better Auth HTTP route', async () => {
  const response = await request('/sign-in/social', {
    provider: 'google',
    callbackURL: callback,
    errorCallbackURL: callback,
    disableRedirect: true,
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  const url = new URL(body.url);
  expect(url.origin).toBe('https://accounts.google.com');
  expect(url.searchParams.get('redirect_uri')).toBe(
    'http://127.0.0.1:3211/api/auth/callback/google',
  );
  expect(url.searchParams.get('state')).toBeTruthy();
  expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
});
it('rejects untrusted cookie-bearing origins and callback destinations', async () => {
  expect(
    (
      await request(
        '/sign-in/social',
        { provider: 'google', callbackURL: callback, disableRedirect: true },
        'https://attacker.example',
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request('/sign-in/social', {
        provider: 'google',
        callbackURL: 'https://attacker.example/auth',
        disableRedirect: true,
      })
    ).status,
  ).toBe(403);
});
it('does not accept email/password login or counterfeit session handoffs', async () => {
  expect(
    (await request('/sign-in/email', { email: 'user@example.com', password: 'password' })).status,
  ).toBeGreaterThanOrEqual(400);
  expect(
    (
      await request('/sign-up/email', {
        email: 'user@example.com',
        name: 'User',
        password: 'password1234',
      })
    ).status,
  ).toBeGreaterThanOrEqual(400);
  expect(
    (await request('/cross-domain/one-time-token/verify', { token: 'invented' })).status,
  ).toBeGreaterThanOrEqual(400);
});
