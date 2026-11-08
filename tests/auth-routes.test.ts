import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authenticatedBackend } from './fixtures/auth';
import { internal } from '../convex/_generated/api';
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
  const duplicate = await request(t, '/sign-up/email', account);
  expect(duplicate.status).toBe(422);
  expect((await duplicate.json()).code).toBe('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL');
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
it('throttles repeated sign-in attempts regardless of NODE_ENV', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  const { unauthenticated: t } = await authenticatedBackend();
  const guess = () =>
    request(t, '/sign-in/email', { email: account.email, password: 'wrong-password' });
  for (let i = 0; i < 10; i++) expect((await guess()).status).toBe(401);
  expect((await guess()).status).toBe(429);
});
it('lets an operator set a password on a password-less account and reset it', async () => {
  const { unauthenticated: t, account: create } = await authenticatedBackend();
  const email = 'google-user@example.com';
  await create(email);
  const signIn = (password: string) => request(t, '/sign-in/email', { email, password });
  const exchange = (token: string) =>
    t.fetch('/api/auth/convex/token', {
      headers: { Authorization: `Bearer ${token}`, Origin: origin },
    });
  expect((await signIn('first-password')).status).toBe(401);
  await t.action(internal.auth.setPassword, { email, password: 'first-password' });
  const first = await signIn('first-password');
  expect(first.status).toBe(200);
  const session = first.headers.get('set-auth-token') as string;
  expect((await exchange(session)).status).toBe(200);
  await t.action(internal.auth.setPassword, {
    email: ` ${email.toUpperCase()} `,
    password: 'second-password',
  });
  expect((await signIn('first-password')).status).toBe(401);
  expect((await signIn('second-password')).status).toBe(200);
  expect((await exchange(session)).status).toBe(401);
  await expect(t.action(internal.auth.setPassword, { email, password: 'short' })).rejects.toThrow(
    'between 8 and 128',
  );
  await expect(
    t.action(internal.auth.setPassword, { email: 'nobody@example.com', password: 'long-enough' }),
  ).rejects.toThrow('No account uses this email');
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
it('resets with an emailed single-use code and revokes prior sessions', async () => {
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  vi.stubEnv('AUTH_EMAIL_FROM', 'Crossmark <test@example.com>');
  let code = '';
  const mail = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    code = body.text.match(/Crossmark: (\S+)/)[1];
    return new Response('{}', { status: 200 });
  });
  try {
    const { unauthenticated: t } = await authenticatedBackend();
    const signup = await request(t, '/sign-up/email', account);
    const oldToken = signup.headers.get('set-auth-token');
    expect((await request(t, '/request-password-reset', { email: account.email })).status).toBe(
      200,
    );
    expect(mail).toHaveBeenCalledTimes(1);
    expect(code).toBeTruthy();
    expect(
      (await request(t, '/reset-password', { token: 'invalid', newPassword: 'new-password123' }))
        .status,
    ).toBe(400);
    expect(
      (await request(t, '/reset-password', { token: code, newPassword: 'short' })).status,
    ).toBe(400);
    expect(
      (await request(t, '/reset-password', { token: code, newPassword: 'new-password123' })).status,
    ).toBe(200);
    expect(
      (await request(t, '/reset-password', { token: code, newPassword: 'another-password' }))
        .status,
    ).toBe(400);
    expect(
      (
        await t.fetch('/api/auth/convex/token', {
          headers: { Authorization: `Bearer ${oldToken}`, Origin: origin },
        })
      ).status,
    ).toBe(401);
    expect(
      (await request(t, '/sign-in/email', { email: account.email, password: 'new-password123' }))
        .status,
    ).toBe(200);
  } finally {
    mail.mockRestore();
  }
});
it('deletes only the authenticated account and requires its password', async () => {
  const { unauthenticated: t, account: other } = await authenticatedBackend();
  const survivor = await other('survivor@example.com');
  const signup = await request(t, '/sign-up/email', account);
  const user = (await signup.json()).user;
  const token = signup.headers.get('set-auth-token');
  await t.run(async (ctx) => {
    for (const ownerId of [user.id, (await survivor.auth.signIn()).id]) {
      const collectionId = await ctx.db.insert('collections', {
        ownerId,
        nodes: [],
        revision: 0,
        sourceDevice: 'test',
        createdAt: Date.now(),
      });
      const deviceId = await ctx.db.insert('devices', {
        ownerId,
        collectionId,
        name: 'test',
        browser: 'test',
        lastSeen: 0,
        cursor: 0,
        sequence: 0,
        revoked: false,
      });
      await ctx.db.insert('operations', {
        collectionId,
        deviceId,
        operationId: 'op',
        sequence: 1,
        revision: 1,
        nodeId: 'node',
        title: 'test',
        kind: 'delete',
        device: 'test',
        at: 0,
        conflict: false,
      });
      await ctx.db.insert('backups', { collectionId, deviceId, nodes: [], at: 0, reason: 'test' });
      await ctx.db.insert('retiredNodes', { collectionId, nodeId: 'deleted-bookmark' });
    }
  });
  const remove = (password?: string) =>
    t.fetch('/api/auth/delete-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password }),
    });
  expect((await remove()).status).toBe(400);
  expect((await remove('wrong-password')).status).toBe(400);
  expect((await remove(account.password)).status).toBe(200);
  await t.run(async (ctx) => {
    expect(await ctx.db.query('collections').collect()).toHaveLength(1);
    expect(await ctx.db.query('devices').collect()).toHaveLength(1);
    expect(await ctx.db.query('backups').collect()).toHaveLength(1);
    expect(await ctx.db.query('operations').collect()).toHaveLength(1);
    expect(await ctx.db.query('retiredNodes').collect()).toHaveLength(1);
  });
  expect((await request(t, '/sign-in/email', account)).status).toBe(401);
});
