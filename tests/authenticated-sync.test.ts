import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ConvexHttpClient } from 'convex/browser';
import { authenticatedBackend } from './fixtures/auth';
import { MemoryBookmarks } from './fixtures/bookmarks';
import { Engine } from '../apps/extension/src/engine';
import { Adapter } from '../apps/extension/src/adapter';
import { initialState, type State, type Store } from '../apps/extension/src/state';
import type { Credentials, SessionAuth } from '../apps/extension/src/auth';
import { api, internal } from '../convex/_generated/api';

const origin = 'chrome-extension://eblopgfhjccjncfjmgcjfahaggkcolok';
const credentials = { email: 'sync@example.com', password: 'disposable-password' };
beforeEach(() => {
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
  vi.stubEnv('BETTER_AUTH_SECRET', 'disposable-test-secret-at-least-thirty-two-characters');
  vi.stubEnv('AUTH_TRUSTED_ORIGINS', origin);
});
afterEach(() => vi.unstubAllEnvs());

// This bridge exercises real auth HTTP handlers and database sessions. convex-test
// supplies the identity from the issued JWT; it does NOT validate JWT signatures
// or exercise Convex's network transport, extension storage, or native browsers.
async function setup() {
  const { unauthenticated: backend } = await authenticatedBackend();
  function device(firefox = false) {
    let state: State = { ...initialState(), browser: firefox ? 'Firefox' : 'Chromium' };
    const store: Store = {
      read: async () => structuredClone(state),
      write: async (next) => {
        state = structuredClone(next);
      },
    };
    const native = new MemoryBookmarks(
      firefox
        ? [
            { id: 'toolbar_____', title: 'Toolbar' },
            { id: 'unfiled_____', title: 'Other' },
            { id: 'menu________', title: 'Menu' },
            { id: 'mobile______', title: 'Mobile' },
          ]
        : undefined,
    );
    const adapter = new Adapter(native, firefox);
    let session: string | undefined;
    let identity: ReturnType<typeof backend.withIdentity> | undefined;
    let offline = false;
    const request = async (path: string, body?: unknown) => {
      if (offline) throw new Error('Network offline');
      const response = await backend.fetch(`/api/auth${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 401 ? 'Sign in to continue.' : `Auth HTTP ${response.status}`,
        );
      return response;
    };
    const auth: SessionAuth = {
      async token() {
        const response = await request('/convex/token');
        const { token } = await response.json();
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        expect(payload.sessionId).toBeTruthy();
        identity = backend.withIdentity({ subject: payload.sub, sessionId: payload.sessionId });
        return token;
      },
      async signIn(input: Credentials) {
        const response = await request(input.create ? '/sign-up/email' : '/sign-in/email', {
          email: input.email,
          password: input.password,
          ...(input.create ? { name: 'Disposable' } : {}),
        });
        session = response.headers.get('set-auth-token')!;
        expect(session).toBeTruthy();
        await auth.token();
        return identity!.query(api.auth.currentUser, {});
      },
      async signOut() {
        await request('/sign-out', {});
        session = undefined;
        identity = undefined;
      },
    };
    const transport = {
      query: (fn: Parameters<typeof backend.query>[0], args: Parameters<typeof backend.query>[1]) =>
        identity!.query(fn, args),
      mutation: (
        fn: Parameters<typeof backend.mutation>[0],
        args: Parameters<typeof backend.mutation>[1],
      ) => identity!.mutation(fn, args),
    } as Pick<ConvexHttpClient, 'query' | 'mutation'>;
    const restart = () =>
      new Engine(store, adapter, 'http://127.0.0.1:3210', undefined, transport, auth);
    return {
      native,
      store,
      adapter,
      transport,
      engine: restart(),
      restart,
      offline: (value: boolean) => {
        offline = value;
      },
    };
  }
  const a = device();
  const b = device(true);
  await a.native.create({
    parentId: '1',
    title: 'Seed',
    url: 'https://example.com/exact?q=1#fragment',
  });
  await a.engine.command({
    type: 'connect',
    choice: 'remote',
    credentials: { ...credentials, create: true },
    name: 'Chromium',
  });
  await b.native.create({
    parentId: 'toolbar_____',
    title: 'Local only',
    url: 'https://local.example/',
  });
  await b.engine.command({ type: 'signIn', credentials });
  expect(b.native.nodes.some((n) => n.title === 'Local only')).toBe(true);
  await b.engine.command({ type: 'connect', choice: 'remote', name: 'Firefox' });
  return { a, b, backend };
}
async function ready(device: Awaited<ReturnType<typeof setup>>['a']) {
  await device.engine.command({ type: 'sync' });
  const state = await device.store.read();
  expect(state.error).toBeUndefined();
  expect(state.outbox).toHaveLength(0);
  return state;
}

it('authenticates two sessions, replaces on join and preserves native IDs on rejoin', async () => {
  const { a, b } = await setup();
  expect(b.native.nodes.filter((n) => n.url).map((n) => n.url)).toEqual([
    'https://example.com/exact?q=1#fragment',
  ]);
  const recovery = (await b.store.read()).joinRecovery;
  expect(recovery?.some((n) => n.title === 'Local only')).toBe(true);
  const before = structuredClone(b.native.nodes);
  const create = vi.spyOn(b.native, 'create');
  const remove = vi.spyOn(b.native, 'remove');
  await ready(a);
  await ready(b);
  await b.engine.command({ type: 'disconnect' });
  await b.engine.command({
    type: 'connect',
    choice: 'remote',
    credentials,
    name: 'Firefox rejoined',
  });
  expect(b.native.nodes).toEqual(before);
  expect((await b.store.read()).joinRecovery).toEqual(recovery);
  expect(create).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it('recovers offline edits across an engine restart and merges concurrent fields', async () => {
  const { a, b } = await setup();
  const local = a.native.nodes.find((n) => n.url)!;
  const remote = b.native.nodes.find((n) => n.url)!;
  a.offline(true);
  await a.native.update(local.id, { title: 'Offline title' });
  await a.engine.sync();
  expect((await a.store.read()).outbox).toHaveLength(1);
  await b.native.update(remote.id, { url: 'https://example.com/concurrent?exact=2#hash' });
  await ready(b);
  a.offline(false);
  a.engine = a.restart();
  await a.engine.startup();
  await ready(b);
  await ready(a);
  for (const device of [a, b]) {
    const node = device.native.nodes.find((n) => n.url)!;
    expect(node.title).toBe('Offline title');
    expect(node.url).toBe('https://example.com/concurrent?exact=2#hash');
  }
});

it('retains queued edits after session revocation and sends them after same-account login', async () => {
  const { a, b, backend } = await setup();
  // Operator password reset ends real database sessions, as documented for expiry testing.
  await backend.action(internal.auth.setPassword, {
    email: credentials.email,
    password: credentials.password,
  });
  await a.native.create({
    parentId: '1',
    title: 'Queued after expiry',
    url: 'https://queued.example/',
  });
  await a.engine.sync();
  expect((await a.store.read()).needsSignIn).toBe(true);
  expect((await a.store.read()).outbox).toHaveLength(1);
  await a.engine.command({ type: 'signIn', credentials });
  await b.engine.command({ type: 'signIn', credentials });
  await ready(a);
  await ready(b);
  expect(b.native.nodes.filter((n) => n.url === 'https://queued.example/')).toHaveLength(1);
});

it('retries a committed write with a lost response exactly once after restart', async () => {
  const { a, b } = await setup();
  const normal = a.transport.mutation;
  let loseResponse = true;
  a.transport.mutation = (async (...args: Parameters<typeof normal>) => {
    const result = await normal(args[0], args[1]);
    if (loseResponse) {
      loseResponse = false;
      throw new TypeError('Network response lost after commit');
    }
    return result;
  }) as typeof normal;
  await a.native.create({ parentId: '1', title: 'Exactly once', url: 'https://once.example/' });
  await a.engine.sync();
  expect((await a.store.read()).outbox).toHaveLength(1);
  a.engine = a.restart();
  await a.engine.startup();
  await ready(a);
  await ready(b);
  expect(b.native.nodes.filter((n) => n.url === 'https://once.example/')).toHaveLength(1);
  expect(
    (await a.store.read()).snapshot?.activity.filter((n) => n.title === 'Exactly once'),
  ).toHaveLength(1);
});
