import { authenticatedBackend } from './fixtures/auth';
import { describe, it, expect, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import { Engine } from '../apps/extension/src/engine';
import { Adapter } from '../apps/extension/src/adapter';
import { MemoryBookmarks } from './fixtures/bookmarks';
import { initialState, type State, type Store } from '../apps/extension/src/state';
import type { ConvexHttpClient } from 'convex/browser';
const credentials = { email: 'test@example.com', password: 'password1234' };
async function setup() {
  const { t, auth } = await authenticatedBackend();
  function device(name: string, browser = 'Chromium') {
    let stored: State = { ...initialState(), name, browser };
    const store: Store = {
      read: async () => structuredClone(stored),
      write: async (s) => {
        stored = structuredClone(s);
      },
    };
    const native = new MemoryBookmarks(
      browser === 'Firefox'
        ? [
            { id: 'toolbar_____', title: 'Toolbar' },
            { id: 'unfiled_____', title: 'Other' },
            { id: 'menu________', title: 'Menu' },
            { id: 'mobile______', title: 'Mobile' },
          ]
        : undefined,
    );
    const adapter = new Adapter(native, browser === 'Firefox');
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
  await a.engine.command({ type: 'connect', credentials, name: 'First' });
  await b.engine.command({ type: 'connect', credentials, name: 'Second' });
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
  it.each([
    ['Helium', 'Chrome'],
    ['Chrome', 'Helium'],
    ['Chrome', 'Firefox'],
    ['Firefox', 'Chrome'],
    ['Helium', 'Firefox'],
    ['Firefox', 'Helium'],
  ])('replaces %s local bookmarks with the cloud tree in %s', async (first, second) => {
    const { device } = await setup();
    const a = device('First', first),
      b = device('Second', second);
    const aRoot = first === 'Firefox' ? 'toolbar_____' : '1';
    const bRoot = second === 'Firefox' ? 'toolbar_____' : '1';
    const bOther = second === 'Firefox' ? 'unfiled_____' : '2';
    const folder = await a.native.create({ parentId: aRoot, title: 'Cloud folder' });
    await a.native.create({ parentId: folder.id, title: 'Cloud', url: 'https://cloud.example' });
    await a.engine.command({ type: 'connect', credentials, name: 'First' });
    const original = (await a.store.read()).snapshot!;
    const localFolder = await b.native.create({ parentId: bRoot, title: 'Local folder' });
    await b.native.create({
      parentId: localFolder.id,
      title: 'Local',
      url: 'https://local.example',
    });
    await b.native.create({ parentId: bOther, title: 'Other', url: 'https://other.example' });
    if (second === 'Firefox') {
      await b.native.create({
        parentId: 'menu________',
        title: 'Menu local',
        url: 'https://menu-local.example',
      });
      await b.native.create({
        parentId: 'mobile______',
        title: 'Mobile local',
        url: 'https://mobile-local.example',
      });
    }
    const managed = { id: 'managed-root', title: 'Managed', folderType: 'managed' };
    b.native.nodes.push(managed);
    const managedItem = await b.native.create({
      parentId: managed.id,
      title: 'Policy',
      url: 'https://policy.example',
    });
    await b.engine.command({ type: 'connect', credentials, name: 'Second' });
    const joined = await ready(b);
    expect(joined.status).toBe('ready');
    expect(joined.snapshot!.nodes).toEqual(original.nodes);
    expect(joined.snapshot!.revision).toBe(original.revision);
    expect(
      b.native.nodes
        .filter((n) => n.url)
        .map((n) => n.url)
        .sort(),
    ).toEqual(
      [
        'https://cloud.example',
        'https://policy.example',
        ...(second === 'Firefox' ? ['https://mobile-local.example'] : []),
      ].sort(),
    );
    expect(b.native.nodes.find((n) => n.id === managedItem.id)).toBeDefined();
    expect(b.native.nodes.find((n) => n.title === 'Local folder')).toBeUndefined();
    expect((await ready(a)).snapshot!.nodes).toEqual(original.nodes);
  });

  it('removes every local duplicate and retains cloud duplicates and Firefox menu bookmarks', async () => {
    const { device } = await setup();
    const a = device('Firefox', 'Firefox'),
      b = device('Chrome', 'Chrome');
    await a.native.create({ parentId: 'menu________', title: '', type: 'separator' });
    for (let i = 0; i < 2; i++)
      await a.native.create({
        parentId: 'menu________',
        title: `Cloud ${i}`,
        url: 'https://same.example',
      });
    await a.engine.command({ type: 'connect', credentials, name: 'Firefox' });
    for (let i = 0; i < 3; i++)
      await b.native.create({ parentId: '1', title: `Local ${i}`, url: 'https://same.example' });
    const original = (await a.store.read()).snapshot!;
    await b.engine.command({ type: 'connect', credentials, name: 'Chrome' });
    expect((await ready(b)).snapshot!.nodes).toEqual(original.nodes);
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(2);
    expect(b.native.nodes.filter((n) => n.type === 'separator')).toHaveLength(0);
    expect(b.native.nodes.filter((n) => n.title === 'Bookmarks Menu')).toHaveLength(1);
  });

  it('syncs portable roots through dual Chrome trees and root ID churn', async () => {
    const { device } = await setup();
    const firefox = device('Firefox', 'Firefox');
    await firefox.native.create({
      parentId: 'toolbar_____',
      title: 'Toolbar item',
      url: 'https://toolbar.example',
    });
    await firefox.native.create({
      parentId: 'menu________',
      title: 'Menu item',
      url: 'https://menu.example',
    });
    await firefox.engine.command({ type: 'connect', credentials, name: 'Firefox' });
    const chrome = device('Chrome', 'Chrome');
    chrome.native.nodes = [
      { id: '1', title: 'Local toolbar', folderType: 'bookmarks-bar', syncing: false },
      { id: '2', title: 'Local other', folderType: 'other', syncing: false },
      { id: '5', title: 'Account toolbar', folderType: 'bookmarks-bar', syncing: true },
      { id: '6', title: 'Account other', folderType: 'other', syncing: true },
      { id: '7', title: 'Speed Dial' },
    ];
    await chrome.native.create({
      parentId: '1',
      title: 'Local only',
      url: 'https://local.example',
    });
    await chrome.engine.command({ type: 'connect', credentials, name: 'Chrome' });
    let state = await ready(chrome);
    expect(state.roots).toMatchObject({ toolbar: '5', other: '6' });
    expect(chrome.native.nodes.find((n) => n.url === 'https://toolbar.example')?.parentId).toBe(
      '5',
    );
    const menu = chrome.native.nodes.find((n) => n.title === 'Bookmarks Menu')!;
    expect(menu.parentId).toBe('6');
    expect(chrome.native.nodes.find((n) => n.url === 'https://menu.example')?.parentId).toBe(
      menu.id,
    );
    expect(chrome.native.nodes.find((n) => n.url === 'https://local.example')?.parentId).toBe('1');
    chrome.native.nodes.find((n) => n.id === '5')!.id = '50';
    chrome.native.nodes.find((n) => n.id === '6')!.id = '60';
    for (const node of chrome.native.nodes) {
      if (node.parentId === '5') node.parentId = '50';
      if (node.parentId === '6') node.parentId = '60';
    }
    state = await ready(chrome);
    expect(state.roots).toMatchObject({ toolbar: '50', other: '60', menu: menu.id });
    expect(state.outbox).toHaveLength(0);
    expect(chrome.native.nodes.filter((n) => n.title === 'Bookmarks Menu')).toHaveLength(1);
    expect((await ready(firefox)).snapshot!.nodes).toHaveLength(2);
  });

  it('keeps legacy cloud mobile descendants from blocking portable projection', async () => {
    const { t, device } = await setup();
    const firefox = device('Firefox', 'Firefox');
    await firefox.native.create({
      parentId: 'toolbar_____',
      title: 'Portable',
      url: 'https://portable.example',
    });
    await firefox.engine.command({ type: 'connect', credentials, name: 'Firefox' });
    const id = (await firefox.store.read()).deviceId as never;
    await t.mutation(api.sync.push, {
      deviceId: id,
      operations: [
        {
          id: 'mobile-folder-op',
          sequence: 1,
          nodeId: 'mobile-folder',
          baseRevision: 0,
          kind: 'create',
          node: {
            id: 'mobile-folder',
            kind: 'folder',
            parentId: 'mobile',
            title: 'Phone',
            order: 0,
            revision: 0,
          },
        },
        {
          id: 'mobile-bookmark-op',
          sequence: 2,
          nodeId: 'mobile-bookmark',
          baseRevision: 0,
          kind: 'create',
          node: {
            id: 'mobile-bookmark',
            kind: 'bookmark',
            parentId: 'mobile-folder',
            title: 'Phone link',
            url: 'https://phone.example',
            order: 0,
            revision: 0,
          },
        },
      ],
    });
    const chrome = device('Chrome', 'Chrome');
    await chrome.engine.command({ type: 'connect', credentials, name: 'Chrome' });
    const state = await ready(chrome);
    expect(state.snapshot!.nodes).toHaveLength(3);
    expect(chrome.native.nodes.filter((n) => n.url).map((n) => n.url)).toEqual([
      'https://portable.example',
    ]);
    expect(chrome.native.nodes.some((n) => n.title === 'Mobile Bookmarks')).toBe(false);
  });

  it('upgrades a persisted mobile baseline without deleting its cloud or native subtree', async () => {
    const { t, device } = await setup();
    const chrome = device('Legacy');
    await chrome.engine.command({ type: 'connect', credentials, name: 'Legacy' });
    const wrapper = await chrome.native.create({ parentId: '2', title: 'Mobile Bookmarks' });
    const folder = await chrome.native.create({ parentId: wrapper.id, title: 'Phone' });
    const link = await chrome.native.create({
      parentId: folder.id,
      title: 'Phone link',
      url: 'https://phone.example',
    });
    const state = await chrome.store.read();
    state.roots.mobile = wrapper.id;
    state.baseline = [
      {
        id: 'legacy-folder',
        kind: 'folder',
        parentId: 'mobile',
        title: 'Phone',
        order: 0,
        revision: 1,
      },
      {
        id: 'legacy-link',
        kind: 'bookmark',
        parentId: 'legacy-folder',
        title: 'Phone link',
        url: 'https://phone.example',
        order: 0,
        revision: 2,
      },
    ];
    state.mappings = { 'legacy-folder': folder.id, 'legacy-link': link.id };
    await chrome.store.write(state);
    await t.mutation(api.sync.push, {
      deviceId: state.deviceId as never,
      operations: [
        {
          id: 'legacy-folder-op',
          sequence: 1,
          nodeId: 'legacy-folder',
          baseRevision: 0,
          kind: 'create',
          node: { ...state.baseline[0], revision: 0 },
        },
        {
          id: 'legacy-link-op',
          sequence: 2,
          nodeId: 'legacy-link',
          baseRevision: 0,
          kind: 'create',
          node: { ...state.baseline[1], revision: 0 },
        },
      ],
    });
    const upgraded = await ready(chrome);
    expect(upgraded.outbox).toHaveLength(0);
    expect(upgraded.snapshot!.nodes).toHaveLength(2);
    expect(chrome.native.nodes.find((n) => n.id === wrapper.id)).toBeDefined();
    expect(chrome.native.nodes.find((n) => n.id === link.id)?.url).toBe('https://phone.example');
    expect(upgraded.baseline).toEqual([]);
  });

  it('recovers an interrupted native deletion while installing the collection', async () => {
    const { a, device } = await connectPair();
    const b = device('Joining');
    for (let i = 0; i < 2; i++)
      await b.native.create({ parentId: '1', title: 'Local', url: `https://local.example/${i}` });
    const remove = b.native.remove.bind(b.native);
    let fail = true;
    b.native.remove = async (id) => {
      await remove(id);
      if (fail) {
        fail = false;
        throw new Error('Interrupted removal');
      }
    };
    await b.engine.command({ type: 'connect', credentials, name: 'Joining' });
    expect((await b.store.read()).journal?.kind).toBe('delete');
    const restarted = new Engine(
      b.store,
      b.adapter,
      'http://127.0.0.1:3210',
      undefined,
      b.transport,
      b.auth,
    );
    await restarted.command({ type: 'sync' });
    expect((await b.store.read()).error).toBeUndefined();
    expect((await b.store.read()).status).toBe('ready');
    expect(b.native.nodes.filter((n) => n.url).map((n) => n.url)).toEqual(['https://one.example']);
    expect((await ready(a)).snapshot!.nodes).toHaveLength(1);
  });

  it('adopts an interrupted cloud create without wiping it on join retry', async () => {
    const { a, device } = await connectPair();
    const b = device('Joining');
    await b.native.create({ parentId: '1', title: 'Local', url: 'https://local.example' });
    const create = b.native.create.bind(b.native);
    let fail = true;
    b.native.create = async (details) => {
      const result = await create(details);
      if (fail) {
        fail = false;
        throw new Error('Interrupted creation');
      }
      return result;
    };
    await b.engine.command({ type: 'connect', credentials, name: 'Joining' });
    expect((await b.store.read()).journal?.kind).toBe('create');
    const created = b.native.nodes.find((n) => n.url === 'https://one.example')!;
    const restarted = new Engine(
      b.store,
      b.adapter,
      'http://127.0.0.1:3210',
      undefined,
      b.transport,
      b.auth,
    );
    await restarted.command({ type: 'sync' });
    expect((await b.store.read()).error).toBeUndefined();
    expect(b.native.nodes.filter((n) => n.url).map((n) => n.url)).toEqual(['https://one.example']);
    expect(b.native.nodes.find((n) => n.url === created.url)?.id).toBe(created.id);
    expect((await ready(a)).snapshot!.nodes).toHaveLength(1);
  });

  it('seeds once and a new empty browser receives the collection', async () => {
    const { a, b } = await connectPair();
    expect((await ready(a)).snapshot?.nodes).toHaveLength(1);
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(1);
    await ready(b);
  });
  it('replaces local bookmarks with an empty cloud collection and retains the recovery export', async () => {
    const { device } = await setup();
    const a = device('Empty first'),
      b = device('Populated second');
    await a.engine.command({ type: 'connect', credentials, name: 'Empty first' });
    await b.native.create({ parentId: '1', title: 'First local', url: 'https://local.example/1' });
    await b.native.create({ parentId: '2', title: 'Second local', url: 'https://local.example/2' });
    await b.engine.command({ type: 'connect', credentials, name: 'Populated second' });
    const state = await ready(b);
    expect(state.snapshot?.nodes).toEqual([]);
    expect(state.status).toBe('ready');
    expect(b.native.nodes.filter((n) => n.url)).toEqual([]);
    const exported = (await b.engine.command({ type: 'export' })) as {
      localRecovery: { url?: string }[];
    };
    expect(exported.localRecovery.map((n) => n.url).sort()).toEqual([
      'https://local.example/1',
      'https://local.example/2',
    ]);
  });
  it('includes a bookmark created during installation in the local replacement pass', async () => {
    const { device } = await setup();
    const a = device('First'),
      b = device('Second');
    await a.native.create({ parentId: '1', title: 'Cloud', url: 'https://cloud.example' });
    await a.engine.command({ type: 'connect', credentials, name: 'First' });
    const create = b.native.create.bind(b.native);
    let inject = true;
    b.native.create = async (details) => {
      const result = await create(details);
      if (inject && details.url === 'https://cloud.example') {
        inject = false;
        await create({ parentId: '1', title: 'During install', url: 'https://during.example' });
      }
      return result;
    };
    await b.engine.command({ type: 'connect', credentials, name: 'Second' });
    expect((await ready(b)).status).toBe('ready');
    expect(b.native.nodes.filter((n) => n.url).map((n) => n.url)).toEqual([
      'https://cloud.example',
    ]);
    expect((await ready(a)).snapshot!.nodes).toHaveLength(1);
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
  it('requires review for mass deletion and keeps a recovery snapshot', async () => {
    const { device } = await setup();
    const a = device('A');
    for (let i = 0; i < 25; i++)
      await a.native.create({ parentId: '1', title: `Item ${i}`, url: `https://example.com/${i}` });
    await a.engine.command({ type: 'connect', credentials, name: 'A' });
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
    await expect(a.engine.command({ type: 'connect', credentials, name: 'A' })).rejects.toThrow(
      'Connection lost',
    );
    await a.native.update(item.id, { title: 'After' });
    await a.engine.command({ type: 'state' });
    await a.engine.command({ type: 'connect', credentials, name: 'A' });
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

it('allows pausing and signing out after the session expires', async () => {
  const { a } = await connectPair();
  a.auth.token = async () => {
    throw new Error('Sign in to continue.');
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
    throw new Error('Sign in to continue.');
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
it('reports an unreachable auth backend as offline, not a sign-in failure', async () => {
  const { a } = await connectPair();
  a.auth.token = async () => {
    throw new Error('Could not reach the Crossmark backend at https://backend.convex.site.');
  };
  await a.engine.sync();
  const state = await a.store.read();
  expect(state.status).toBe('offline');
  expect(state.needsSignIn).toBe(false);
});
it('rejects changing accounts on an existing installation', async () => {
  const { a } = await connectPair();
  const previous = await a.store.read();
  a.auth.signIn = async () => ({ id: 'different-user', email: 'other@example.com', name: 'Other' });
  await expect(a.engine.command({ type: 'connect', credentials, name: 'A' })).rejects.toThrow(
    'Sign in as',
  );
  const state = await a.store.read();
  expect(state.account).toEqual(previous.account);
  expect(state.deviceId).toBe(previous.deviceId);
  expect(state.needsSignIn).toBe(true);
});

it('records connection, reconciliation, retry and bookmark diagnostics without content', async () => {
  const { debug } = await import('../apps/extension/src/debug');
  const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  debug.clear();
  debug.setEnabled(true);
  try {
    const { device } = await setup();
    const a = device('Private device');
    await a.native.create({
      parentId: '1',
      title: 'Secret bookmark',
      url: 'https://secret.example',
    });
    await a.engine.command({ type: 'connect', credentials, name: 'Private device' });
    await a.engine.command({ type: 'pause' });
    await a.engine.sync();
    await a.engine.command({ type: 'pause' });
    const query = vi
      .spyOn(a.transport, 'query')
      .mockRejectedValue(new Error('network https://secret.example'));
    await a.engine.sync();
    await a.engine.sync();
    query.mockRestore();
    await a.engine.command({ type: 'sync' });
    await a.engine.command({ type: 'disconnect' });
    const exported = debug.export();
    const entries = JSON.parse(exported).entries;
    for (const [operation, outcome] of [
      ['command.connect', 'success'],
      ['command.disconnect', 'success'],
      ['bookmarks.read', 'success'],
      ['sync.capture', 'success'],
      ['sync.project', 'success'],
      ['sync.exchange', 'paused'],
      ['sync.exchange', 'failure'],
      ['sync.retry', 'scheduled'],
      ['sync.retry', 'backoff'],
    ])
      expect(entries).toContainEqual(expect.objectContaining({ operation, outcome }));
    for (const secret of ['Private device', 'Secret bookmark', 'https://secret.example'])
      expect(exported).not.toContain(secret);
  } finally {
    debug.setEnabled(false);
    debug.clear();
    consoleSpy.mockRestore();
  }
});
