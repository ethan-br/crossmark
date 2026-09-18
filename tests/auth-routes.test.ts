import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authenticatedBackend } from './fixtures/auth';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
it('accepts the Firefox build callback and relays the unchanged Google URL', async () => {
  // Bind the regression to the actual build ID, not a mock browser identity.
  const build = readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  const addonId = build.match(/id: '(crossmark[^']+)'/)![1];
  const hash = createHash('sha1').update(addonId).digest('hex');
  const redirect = `https://${hash}.extensions.allizom.org/auth`;
  expect(redirect).toBe(
    'https://e75a80704b2a90a50aa2f2ce7d240a397e57b612.extensions.allizom.org/auth',
  );
  const firefoxOrigin = 'moz-extension://test-profile';
  vi.stubEnv('AUTH_TRUSTED_ORIGINS', `${firefoxOrigin},${new URL(redirect).origin}`);
  const response = await request(
    '/sign-in/social',
    {
      provider: 'google',
      callbackURL: `${redirect}?state=firefox-nonce`,
      errorCallbackURL: `${redirect}?state=firefox-nonce`,
      disableRedirect: true,
    },
    firefoxOrigin,
  );
  expect(response.status).toBe(200);
  const { url } = await response.json();
  expect(new URL(url).searchParams.get('redirect_uri')).toBe(
    'http://127.0.0.1:3211/api/auth/callback/google',
  );
  const { unauthenticated: t } = await authenticatedBackend();
  const relay = await t.fetch(`/extension/google-launch?authorization=${encodeURIComponent(url)}`);
  expect(relay.status).toBe(302);
  expect(relay.headers.get('location')).toBe(url);
  expect(relay.headers.get('cache-control')).toBe('no-store');
  expect(relay.headers.get('referrer-policy')).toBe('no-referrer');
});
it.each([
  '',
  'not-a-url',
  'https://attacker.example/',
  'https://accounts.google.com.evil.example/o/oauth2/v2/auth',
  'https://accounts.google.com/logout',
  'https://accounts.google.com/o/oauth2/v2/auth?client_id=other&redirect_uri=https://evil.example&response_type=code&state=x',
])('rejects invalid Firefox relay destinations: %s', async (url) => {
  const { unauthenticated: t } = await authenticatedBackend();
  const response = await t.fetch(
    `/extension/google-launch?authorization=${encodeURIComponent(url)}`,
  );
  expect(response.status).toBe(400);
  expect(response.headers.has('location')).toBe(false);
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
