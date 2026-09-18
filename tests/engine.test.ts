import { authenticatedBackend } from './fixtures/auth';
import { describe, it, expect } from 'vitest';
import { api } from '../convex/_generated/api';
import { Engine } from '../apps/extension/src/engine';
import { Adapter } from '../apps/extension/src/adapter';
import { MemoryBookmarks } from './fixtures/bookmarks';
import { initialState, type State, type Store } from '../apps/extension/src/state';
import type { ConvexHttpClient } from 'convex/browser';
async function setup() {
  const { t, auth } = await authenticatedBackend();
  function device(name: string) {
    let stored: State = { ...initialState(), name };
    const store: Store = {
      read: async () => structuredClone(stored),
      write: async (s) => {
        stored = structuredClone(s);
      },
    };
    const native = new MemoryBookmarks();
    const adapter = new Adapter(native, false);
    const transport = { query: t.query.bind(t), mutation: t.mutation.bind(t) } as Pick<
      ConvexHttpClient,
      'query' | 'mutation'
    >;
    const engine = new Engine(store, adapter, 'http://127.0.0.1:3210', undefined, transport, auth);
    return { native, store, engine, adapter, transport, auth };
  }
  return { t, device };
}
async function connectPair() {
  const env = await setup();
  const a = env.device('First');
  const b = env.device('Second');
  await a.native.create({ title: 'First bookmark', url: 'https://one.example', parentId: '1' });
  await a.engine.command({ type: 'connect', name: 'First' });
  await b.engine.command({ type: 'connect', name: 'Second' });
  return { ...env, a, b };
}
async function ready(d: ReturnType<Awaited<ReturnType<typeof setup>>['device']>) {
  await d.engine.sync();
  const s = await d.store.read();
  expect(s.error).toBeUndefined();
  expect(s.status).toBe('ready');
  return s;
}
describe('two-browser synchronization and recovery', () => {
  it('seeds once and a new empty browser receives the collection', async () => {
    const { a, b } = await connectPair();
    expect((await ready(a)).snapshot?.nodes).toHaveLength(1);
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(1);
    await ready(b);
  });
  it('propagates create, rename, move, reorder and delete without echoes', async () => {
    const { a, b } = await connectPair();
    const f = await a.native.create({ title: 'Work', parentId: '1' });
    const bookmark = await a.native.create({
      title: 'Second',
      url: 'https://two.example/#a',
      parentId: f.id,
    });
    await ready(a);
    await ready(b);
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(2);
    await a.native.update(bookmark.id, { title: 'Renamed' });
    await a.native.move(bookmark.id, { parentId: '1', index: 0 });
    await ready(a);
    await ready(b);
    const remote = b.native.nodes.find((n) => n.title === 'Renamed')!;
    expect(remote.parentId).toBe('1');
    expect(remote.index).toBe(0);
    await b.native.remove(remote.id);
    await ready(b);
    await ready(a);
    expect(a.native.nodes.find((n) => n.title === 'Renamed')).toBeUndefined();
    const revision = (await a.store.read()).snapshot!.revision;
    await ready(a);
    await ready(b);
    expect((await a.store.read()).snapshot!.revision).toBe(revision);
  });
  it('requires explicit review to merge a nonempty joining browser', async () => {
    const { device } = await setup();
    const a = device('A'),
      b = device('B');
    await a.native.create({ parentId: '1', title: 'A', url: 'https://same.example' });
    await b.native.create({ parentId: '1', title: 'B', url: 'https://same.example' });
    await a.engine.command({ type: 'connect', name: 'A' });
    await b.engine.command({ type: 'connect', name: 'B' });
    expect((await b.store.read()).status).toBe('review');
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(1);
    await b.engine.command({ type: 'approve' });
    await ready(a);
    await ready(b);
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(2);
    expect(a.native.nodes.filter((n) => n.url)).toHaveLength(2);
  });
  it('retains paused changes durably and resumes them', async () => {
    const { a, b } = await connectPair();
    await a.engine.command({ type: 'pause' });
    await a.native.create({ parentId: '1', title: 'Offline', url: 'https://offline.example' });
    await a.engine.sync();
    expect((await a.store.read()).outbox).toHaveLength(1);
    await ready(b);
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(1);
    await a.engine.command({ type: 'pause' });
    await ready(b);
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(2);
  });
  it('reconciles edits missed while the background was stopped', async () => {
    const { a, b } = await connectPair();
    await a.native.update(a.native.nodes.find((n) => n.url)!.id, { title: 'While stopped' });
    const restarted = new Engine(
      a.store,
      a.adapter,
      'http://127.0.0.1:3210',
      undefined,
      a.transport,
      a.auth,
    );
    await restarted.sync();
    await ready(b);
    expect(b.native.nodes.find((n) => n.url)?.title).toBe('While stopped');
  });
  it('recovers creation after a crash between native write and mapping persistence', async () => {
    const { a } = await connectPair();
    const state = await a.store.read();
    const target = {
      id: 'crash',
      kind: 'bookmark' as const,
      parentId: 'toolbar',
      order: 1,
      title: 'Created before crash',
      url: 'https://crash.example',
      revision: 1,
    };
    state.journal = {
      kind: 'create',
      target,
      childrenBefore: (await a.native.getChildren('1')).map((n) => n.id),
    };
    await a.store.write(state);
    await a.native.create({ parentId: '1', title: target.title, url: target.url });
    const loaded = await a.store.read();
    await a.adapter.recover(loaded, a.store);
    expect(a.native.nodes.filter((n) => n.url === target.url)).toHaveLength(1);
    expect((await a.store.read()).mappings.crash).toBeDefined();
    expect((await a.store.read()).journal).toBeUndefined();
  });
  it('safely pauses on root disappearance rather than deleting the collection', async () => {
    const { a } = await connectPair();
    a.native.nodes = a.native.nodes.filter((n) => n.id !== '1');
    await a.engine.sync();
    expect((await a.store.read()).status).toBe('error');
    expect((await a.store.read()).outbox).toHaveLength(0);
  });
  it('revocation leaves native bookmarks intact', async () => {
    const { a, b, t } = await connectPair();
    const state = await a.store.read();
    await t.mutation(api.sync.revoke, {
      deviceId: state.deviceId as never,
      targetDeviceId: (await b.store.read()).deviceId as never,
    });
    await b.engine.sync();
    expect((await b.store.read()).status).toBe('error');
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(1);
  });
});

describe('safety and partial failure regressions', () => {
  it('cannot bypass a joining merge review by pausing and resuming', async () => {
    const { device } = await setup();
    const a = device('A'),
      b = device('B');
    await a.engine.command({ type: 'connect', name: 'A' });
    await b.native.create({ parentId: '1', title: 'Local only', url: 'https://local.example' });
    await b.engine.command({ type: 'connect', name: 'B' });
    await b.engine.command({ type: 'pause' });
    await b.engine.command({ type: 'pause' });
    expect((await b.store.read()).status).toBe('review');
    expect((await ready(a)).snapshot?.nodes).toHaveLength(0);
  });
  it('requires review for mass deletion and keeps a recovery snapshot', async () => {
    const { device } = await setup();
    const a = device('A');
    for (let i = 0; i < 25; i++)
      await a.native.create({ parentId: '1', title: `Item ${i}`, url: `https://example.com/${i}` });
    await a.engine.command({ type: 'connect', name: 'A' });
    for (const n of [...a.native.nodes].filter((n) => n.url)) await a.native.remove(n.id);
    await a.engine.sync();
    let s = await a.store.read();
    expect(s.status).toBe('review');
    expect(s.backup).toHaveLength(25);
    expect(s.snapshot?.nodes.filter((n) => !n.deleted)).toHaveLength(25);
    await a.engine.command({ type: 'approve' });
    s = await ready(a);
    expect(s.snapshot?.nodes.every((n) => n.deleted)).toBe(true);
  });
  it('recovers an acknowledged batch whose response was lost', async () => {
    const { a, b } = await connectPair();
    const normal = a.transport.mutation;
    let fail = true;
    a.transport.mutation = (async (...args: Parameters<typeof normal>) => {
      const result = await normal(args[0], args[1]);
      if (fail) {
        fail = false;
        throw new TypeError('Network response lost');
      }
      return result;
    }) as typeof normal;
    await a.native.create({ parentId: '1', title: 'Exactly once', url: 'https://once.example' });
    await a.engine.sync();
    expect((await a.store.read()).outbox).toHaveLength(1);
    await a.engine.command({ type: 'sync' });
    await ready(b);
    expect(b.native.nodes.filter((n) => n.title === 'Exactly once')).toHaveLength(1);
    expect(
      (await a.store.read()).snapshot?.activity.filter((n) => n.title === 'Exactly once'),
    ).toHaveLength(1);
  });
  it('retains edits made after an interrupted first initialization', async () => {
    const { device } = await setup();
    const a = device('A');
    const item = await a.native.create({
      parentId: '1',
      title: 'Before',
      url: 'https://before.example',
    });
    const normal = a.transport.mutation;
    let fail = true;
    a.transport.mutation = (async (...args: Parameters<typeof normal>) => {
      const result = await normal(args[0], args[1]);
      if (fail) {
        fail = false;
        throw new TypeError('Connection lost after initialization');
      }
      return result;
    }) as typeof normal;
    await expect(a.engine.command({ type: 'connect', name: 'A' })).rejects.toThrow(
      'Connection lost',
    );
    await a.native.update(item.id, { title: 'After' });
    await a.engine.command({ type: 'state' });
    await a.engine.command({ type: 'connect', name: 'A' });
    expect((await ready(a)).snapshot?.nodes[0].title).toBe('After');
  });
  it('preserves unrelated edits received during remote projection', async () => {
    const { a, b } = await connectPair();
    const original = b.native.nodes.find((n) => n.url)!;
    await a.native.create({
      parentId: '1',
      title: 'Remote addition',
      url: 'https://remote.example',
    });
    await ready(a);
    const create = b.native.create.bind(b.native);
    let injected = false;
    b.native.create = async (details) => {
      const result = await create(details);
      if (!injected) {
        injected = true;
        await b.native.update(original.id, { title: 'Concurrent user edit' });
      }
      return result;
    };
    await ready(b);
    await ready(a);
    expect(a.native.nodes.find((n) => n.url === 'https://one.example')?.title).toBe(
      'Concurrent user edit',
    );
    expect(b.native.nodes.filter((n) => n.title === 'Remote addition')).toHaveLength(1);
  });
});

it('moves a surviving child before deleting its former folder', async () => {
  const { a, b } = await connectPair();
  const folder = await a.native.create({ parentId: '1', title: 'Temporary folder' });
  const child = await a.native.create({
    parentId: folder.id,
    title: 'Keep me',
    url: 'https://keep.example',
  });
  await ready(a);
  await ready(b);
  await a.native.move(child.id, { parentId: '2' });
  await a.native.remove(folder.id);
  await ready(a);
  await ready(b);
  expect(b.native.nodes.find((n) => n.title === 'Keep me')?.parentId).toBe('2');
  expect(b.native.nodes.find((n) => n.title === 'Temporary folder')).toBeUndefined();
});

it('allows a revoked browser without pending work to clear its connection', async () => {
  const { a, b } = await connectPair();
  await a.engine.command({ type: 'revoke', deviceId: (await b.store.read()).deviceId! });
  await b.engine.command({ type: 'disconnect' });
  expect((await b.store.read()).connected).toBe(false);
  expect(b.native.nodes.filter((n) => n.url)).toHaveLength(1);
});
it('serves live persisted status while a network exchange is pending', async () => {
  const { a } = await connectPair();
  const original = a.transport.query;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  a.transport.query = (async (...args: Parameters<typeof original>) => {
    await gate;
    return original(args[0], args[1]);
  }) as typeof original;
  const sync = a.engine.sync();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const state = (await a.engine.command({ type: 'state' })) as State;
  expect(state.status).toBe('syncing');
  release();
  await sync;
});

it('allows pausing and signing out after the Google session expires', async () => {
  const { a } = await connectPair();
  a.auth.token = async () => {
    throw new Error('Sign in with Google to continue.');
  };
  await a.engine.command({ type: 'pause' });
  expect((await a.store.read()).paused).toBe(true);
  await a.engine.command({ type: 'disconnect' });
  expect((await a.store.read()).connected).toBe(false);
  expect(a.native.nodes.filter((n) => n.url)).toHaveLength(1);
});
it('keeps pending edits when reauthentication is needed', async () => {
  const { a } = await connectPair();
  a.auth.token = async () => {
    throw new Error('Sign in with Google to continue.');
  };
  await a.native.create({
    parentId: '1',
    title: 'Waiting for login',
    url: 'https://pending.example',
  });
  await a.engine.sync();
  const state = await a.store.read();
  expect(state.needsSignIn).toBe(true);
  expect(state.outbox).toHaveLength(1);
  const exported = (await a.engine.command({ type: 'export' })) as { pending: unknown[] };
  expect(exported.pending).toHaveLength(1);
});
it('rejects changing Google accounts on an existing installation', async () => {
  const { a } = await connectPair();
  const previous = await a.store.read();
  a.auth.signIn = async () => ({ id: 'different-user', email: 'other@example.com', name: 'Other' });
  await expect(a.engine.command({ type: 'connect', name: 'A' })).rejects.toThrow('Sign in as');
  const state = await a.store.read();
  expect(state.account).toEqual(previous.account);
  expect(state.deviceId).toBe(previous.deviceId);
  expect(state.needsSignIn).toBe(true);
});
