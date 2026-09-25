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
  ])('replaces %s bookmarks in %s with the cloud tree', async (first, second) => {
    const { device } = await setup();
    const a = device('First', first),
      b = device('Second', second);
    const aRoot = first === 'Firefox' ? 'toolbar_____' : '1';
    const bRoot = second === 'Firefox' ? 'toolbar_____' : '1';
    const cloudFolder = await a.native.create({ parentId: aRoot, title: 'Work' });
    const seeded = await a.native.create({
      parentId: cloudFolder.id,
      title: 'Cloud title',
      url: 'https://shared.example',
    });
    await a.engine.command({ type: 'connect', credentials, name: 'First' });
    const original = (await a.store.read()).snapshot!;
    const local = await b.native.create({
      parentId: bRoot,
      title: 'Local title',
      url: 'https://shared.example',
    });
    const localFolder = await b.native.create({ parentId: bRoot, title: 'Local folder' });
    await b.native.create({
      parentId: localFolder.id,
      title: 'Local only',
      url: 'https://local.example',
    });
    b.native.nodes.push({ id: 'managed', title: 'Managed', unmodifiable: 'managed' });
    b.native.nodes.push({
      id: 'managed-child',
      parentId: 'managed',
      index: 0,
      title: 'Policy',
      url: 'https://policy.example',
    });
    await b.engine.command({ type: 'connect', credentials, name: 'Second' });
    const installed = await ready(b);
    expect(installed.snapshot!.nodes).toEqual(original.nodes);
    expect(installed.snapshot!.revision).toBe(original.revision);
    expect(b.native.nodes.find((n) => n.id === local.id)).toBeUndefined();
    expect(b.native.nodes.find((n) => n.id === localFolder.id)).toBeUndefined();
    expect(b.native.nodes.filter((n) => n.url && n.id !== 'managed-child')).toHaveLength(1);
    expect(b.native.nodes.find((n) => n.url === 'https://shared.example')?.title).toBe(
      'Cloud title',
    );
    expect(b.native.nodes.find((n) => n.id === 'managed-child')?.url).toBe(
      'https://policy.example',
    );
    expect(a.native.nodes.find((n) => n.url === 'https://shared.example')?.id).toBe(seeded.id);
    await b.engine.command({ type: 'disconnect' });
    await b.native.create({
      parentId: bRoot,
      title: 'New local',
      url: 'https://new-local.example',
    });
    await b.engine.command({ type: 'connect', credentials, name: 'Second' });
    expect((await ready(b)).snapshot!.nodes).toEqual(original.nodes);
    expect(b.native.nodes.some((n) => n.url === 'https://new-local.example')).toBe(false);
  });

  it('does not import local bookmarks from simultaneous new browsers', async () => {
    const { device } = await setup();
    const a = device('A'),
      b = device('B'),
      c = device('C');
    await a.engine.command({ type: 'connect', credentials, name: 'A' });
    for (const d of [b, c]) {
      await d.native.create({ parentId: '1', title: 'Local', url: 'https://new.example' });
      await d.engine.command({ type: 'connect', credentials, name: 'Joining' });
    }
    for (const d of [a, b, c]) {
      expect((await ready(d)).snapshot!.nodes).toHaveLength(0);
      expect(d.native.nodes.filter((n) => n.url)).toHaveLength(0);
    }
  });

  it('replaces Firefox menu and other contents without touching mobile', async () => {
    const { device } = await setup();
    const a = device('Chrome', 'Chrome');
    const b = device('Firefox', 'Firefox');
    await a.native.create({ parentId: '1', title: 'Cloud', url: 'https://cloud.example' });
    await a.engine.command({ type: 'connect', credentials, name: 'Chrome' });
    await b.native.create({
      parentId: 'menu________',
      title: 'Menu local',
      url: 'https://menu-local.example',
    });
    await b.native.create({
      parentId: 'unfiled_____',
      title: 'Other local',
      url: 'https://other-local.example',
    });
    await b.native.create({
      parentId: 'mobile______',
      title: 'Mobile local',
      url: 'https://mobile-local.example',
    });
    await b.engine.command({ type: 'connect', credentials, name: 'Firefox' });
    expect((await ready(b)).snapshot!.nodes).toHaveLength(1);
    expect(b.native.nodes.filter((n) => n.url).map((n) => n.url).sort()).toEqual([
      'https://cloud.example',
      'https://mobile-local.example',
    ]);
    for (const id of ['toolbar_____', 'unfiled_____', 'menu________', 'mobile______'])
      expect(b.native.nodes.some((n) => n.id === id)).toBe(true);
  });

  it('preserves cloud duplicates, menu roots and separators through a Chromium reconnect', async () => {
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
      await b.native.create({ parentId: '1', title: 'Overlap', url: 'https://same.example' });
    const original = (await a.store.read()).snapshot!;
    await b.engine.command({ type: 'connect', credentials, name: 'Chrome' });
    expect((await ready(b)).snapshot!.nodes).toEqual(original.nodes);
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(2);
    expect(b.native.nodes.filter((n) => n.type === 'separator')).toHaveLength(0);
    await b.engine.command({ type: 'disconnect' });
    await b.engine.command({ type: 'connect', credentials, name: 'Chrome' });
    expect((await ready(b)).snapshot!.nodes).toEqual(original.nodes);
    expect(b.native.nodes.filter((n) => n.title === 'Bookmarks Menu')).toHaveLength(1);
    expect((await ready(a)).snapshot!.revision).toBe(original.revision);
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

  it('keeps legacy cloud mobile nodes while replacing a joining portable bookmark', async () => {
    const { t, device } = await setup();
    const source = device('Source');
    await source.engine.command({ type: 'connect', credentials, name: 'Source' });
    await t.mutation(api.sync.push, {
      deviceId: (await source.store.read()).deviceId as never,
      operations: [
        {
          id: 'legacy-folder-op',
          sequence: 1,
          nodeId: 'legacy-folder',
          baseRevision: 0,
          kind: 'create',
          node: {
            id: 'legacy-folder',
            kind: 'folder',
            parentId: 'mobile',
            title: 'Phone',
            order: 0,
            revision: 0,
          },
        },
        {
          id: 'legacy-link-op',
          sequence: 2,
          nodeId: 'legacy-link',
          baseRevision: 0,
          kind: 'create',
          node: {
            id: 'legacy-link',
            kind: 'bookmark',
            parentId: 'legacy-folder',
            title: 'Cloud phone link',
            url: 'https://phone.example',
            order: 0,
            revision: 0,
          },
        },
      ],
    });
    const joining = device('Joining');
    const local = await joining.native.create({
      parentId: '1',
      title: 'Local toolbar link',
      url: 'https://phone.example',
    });
    await joining.engine.command({ type: 'connect', credentials, name: 'Joining' });
    const state = await ready(joining);
    expect(joining.native.nodes.find((n) => n.id === local.id)).toBeUndefined();
    expect(state.snapshot!.nodes.filter((n) => n.url === 'https://phone.example')).toHaveLength(1);
    expect(state.baseline).toEqual([]);
    expect(state.outbox).toHaveLength(0);
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

  it('removes nested local folders before installing the cloud tree', async () => {
    const { a, device } = await connectPair();
    const b = device('Joining');
    for (let i = 0; i < 2; i++) {
      const folder = await b.native.create({ parentId: '1', title: 'Work' });
      await b.native.create({
        parentId: folder.id,
        title: `Local ${i}`,
        url: `https://local.example/${i}`,
      });
    }
    await b.engine.command({ type: 'connect', credentials, name: 'Joining' });
    expect((await ready(b)).snapshot!.nodes).toHaveLength(1);
    expect(b.native.nodes.filter((n) => n.title === 'Work')).toHaveLength(0);
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(1);
    expect((await ready(a)).snapshot!.nodes).toHaveLength(1);
  });

  it('recovers a local removal interrupted after the native write', async () => {
    const { a, device } = await connectPair();
    const b = device('Joining');
    await b.native.create({ parentId: '1', title: 'Local', url: 'https://local.example' });
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
    expect((await ready(b)).journal).toBeUndefined();
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(1);
    expect((await ready(a)).snapshot!.nodes).toHaveLength(1);
  });

  it('recovers an interrupted cloud create without wiping it on restart', async () => {
    const { a, device } = await connectPair();
    const b = device('Joining');
    await b.native.create({ parentId: '1', title: 'Local', url: 'https://local.example' });
    const create = b.native.create.bind(b.native);
    let fail = true;
    b.native.create = async (details) => {
      const created = await create(details);
      if (fail) {
        fail = false;
        throw new Error('Interrupted create');
      }
      return created;
    };
    await b.engine.command({ type: 'connect', credentials, name: 'Joining' });
    expect((await b.store.read()).journal?.kind).toBe('create');
    expect((await b.store.read()).joinWiped).toBe(true);
    const firstNative = b.native.nodes.find((n) => n.url === 'https://one.example')!.id;
    const restarted = new Engine(
      b.store,
      b.adapter,
      'http://127.0.0.1:3210',
      undefined,
      b.transport,
      b.auth,
    );
    await restarted.command({ type: 'sync' });
    expect((await ready(b)).joining).toBe(false);
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(1);
    expect(b.native.nodes.find((n) => n.url === 'https://one.example')?.id).toBe(firstNative);
    expect((await ready(a)).snapshot!.nodes).toHaveLength(1);
  });

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
  it('keeps native IDs and only writes changed nodes during incremental sync', async () => {
    const { a, b } = await connectPair();
    const unchanged = b.native.nodes.find((n) => n.url === 'https://one.example')!;
    const create = vi.spyOn(b.native, 'create');
    const update = vi.spyOn(b.native, 'update');
    const move = vi.spyOn(b.native, 'move');
    const remove = vi.spyOn(b.native, 'remove');
    await ready(b);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    const changed = await a.native.create({
      parentId: '1',
      index: 0,
      title: 'Changed',
      url: 'https://changed.example',
    });
    await ready(a);
    await ready(b);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    const installed = b.native.nodes.find((n) => n.url === changed.url)!;
    create.mockClear();
    move.mockClear();

    await a.native.update(changed.id, { title: 'Renamed' });
    await ready(a);
    await ready(b);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      installed.id,
      expect.objectContaining({ title: 'Renamed' }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    await a.native.move(changed.id, { parentId: '2', index: 0 });
    await ready(a);
    await ready(b);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith(installed.id, expect.objectContaining({ parentId: '2' }));
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(b.native.nodes.find((n) => n.url === unchanged.url)?.id).toBe(unchanged.id);

    await a.native.remove(changed.id);
    await ready(a);
    await ready(b);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(installed.id);
    expect(b.native.nodes.find((n) => n.url === unchanged.url)?.id).toBe(unchanged.id);
  });
  it('connects a nonempty browser without review or merge', async () => {
    const { device } = await setup();
    const a = device('A'),
      b = device('B');
    await a.native.create({ parentId: '1', title: 'Cloud', url: 'https://same.example' });
    await b.native.create({ parentId: '1', title: 'Local', url: 'https://same.example' });
    await b.native.create({ parentId: '2', title: 'Other local', url: 'https://other.example' });
    await a.engine.command({ type: 'connect', credentials, name: 'A' });
    await b.engine.command({ type: 'connect', credentials, name: 'B' });
    expect((await b.store.read()).status).toBe('ready');
    expect(b.native.nodes.filter((n) => n.url).map((n) => n.title)).toEqual(['Cloud']);
    expect((await ready(a)).snapshot!.nodes).toHaveLength(1);
  });
  it('retains paused changes durably and resumes them', async () => {
    const { a, b } = await connectPair();
    await a.engine.command({ type: 'pause' });
    await a.native.create({ parentId: '1', title: 'Offline', url: 'https://offline.example' });
    await a.engine.sync();
    expect((await a.store.read()).outbox).toHaveLength(1);
    const restarted = new Engine(
      a.store,
      a.adapter,
      'http://127.0.0.1:3210',
      undefined,
      a.transport,
      a.auth,
    );
    await restarted.startup();
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
  it('sends a pending outbox and pulls cloud changes on startup without a manual sync', async () => {
    const { a, b } = await connectPair();
    const push = vi.spyOn(a.transport, 'mutation').mockRejectedValueOnce(new TypeError('Offline'));
    await a.native.create({ parentId: '1', title: 'Pending', url: 'https://pending.example' });
    await a.engine.sync();
    push.mockRestore();
    expect((await a.store.read()).outbox).toHaveLength(1);
    expect((await a.store.read()).nextRetryAt).toBeDefined();
    const restarted = new Engine(
      a.store,
      a.adapter,
      'http://127.0.0.1:3210',
      undefined,
      a.transport,
      a.auth,
    );
    await restarted.startup();
    expect((await a.store.read()).outbox).toHaveLength(0);
    await ready(b);
    expect(b.native.nodes.some((n) => n.url === 'https://pending.example')).toBe(true);

    await b.native.create({ parentId: '2', title: 'Remote', url: 'https://remote.example' });
    await ready(b);
    await restarted.startup();
    expect(a.native.nodes.some((n) => n.url === 'https://remote.example')).toBe(true);
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
  it('keeps a paused joining browser untouched until resume', async () => {
    const { device } = await setup();
    const a = device('A'),
      b = device('B');
    await a.native.create({ parentId: '1', title: 'Cloud', url: 'https://cloud.example' });
    await a.engine.command({ type: 'connect', credentials, name: 'A' });
    await b.native.create({ parentId: '1', title: 'Local', url: 'https://local.example' });
    const query = vi
      .spyOn(b.transport, 'query')
      .mockResolvedValueOnce((await a.store.read()).snapshot as never)
      .mockRejectedValueOnce(new TypeError('Offline'));
    await b.engine.command({ type: 'connect', credentials, name: 'B' });
    query.mockRestore();
    await b.engine.command({ type: 'pause' });
    await b.engine.sync();
    expect(b.native.nodes.some((n) => n.url === 'https://local.example')).toBe(true);
    await b.engine.command({ type: 'pause' });
    expect((await ready(b)).joining).toBe(false);
    expect(b.native.nodes.filter((n) => n.url).map((n) => n.title)).toEqual(['Cloud']);
  });
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
describe('browser controls', () => {
  const peer = async (viewer: { store: Store }, target: { store: Store }) => {
    const id = (await target.store.read()).deviceId;
    return (await viewer.store.read()).snapshot!.devices.find((d) => d.id === id)!;
  };
  it('reports a local pause and resume to other browsers', async () => {
    const { a, b } = await connectPair();
    await a.engine.command({ type: 'pause' });
    expect((await a.store.read()).pausePending).toBeUndefined();
    await ready(b);
    expect((await peer(b, a)).paused).toBe(true);
    await a.engine.command({
      type: 'pauseDevice',
      deviceId: (await a.store.read()).deviceId!,
      paused: false,
    });
    await ready(b);
    expect((await peer(b, a)).paused).toBe(false);
  });
  it('pauses and resumes another browser remotely', async () => {
    const { a, b } = await connectPair();
    await ready(b);
    const target = (await b.store.read()).deviceId!;
    await a.engine.command({ type: 'pauseDevice', deviceId: target, paused: true });
    expect((await a.store.read()).paused).toBe(false);
    expect((await peer(a, b)).paused).toBe(true);
    await b.engine.sync();
    expect((await b.store.read()).paused).toBe(true);
    expect((await b.store.read()).status).toBe('paused');
    await a.native.create({ parentId: '1', title: 'While paused', url: 'https://paused.example' });
    await b.native.create({ parentId: '1', title: 'Held back', url: 'https://held.example' });
    await ready(a);
    await b.engine.sync();
    expect(b.native.nodes.find((n) => n.url === 'https://paused.example')).toBeUndefined();
    expect((await b.store.read()).outbox).toHaveLength(1);
    await a.engine.command({ type: 'pauseDevice', deviceId: target, paused: false });
    expect((await peer(a, b)).paused).toBe(false);
    const resumed = await ready(b);
    expect(resumed.paused).toBe(false);
    expect(resumed.outbox).toHaveLength(0);
    expect(b.native.nodes.find((n) => n.url === 'https://paused.example')).toBeDefined();
    await ready(a);
    expect(a.native.nodes.find((n) => n.url === 'https://held.example')).toBeDefined();
  });
  it('lets a remotely paused browser resume itself', async () => {
    const { a, b } = await connectPair();
    const target = (await b.store.read()).deviceId!;
    await a.engine.command({ type: 'pauseDevice', deviceId: target, paused: true });
    await b.engine.sync();
    expect((await b.store.read()).paused).toBe(true);
    await b.engine.command({ type: 'pause' });
    expect((await ready(b)).paused).toBe(false);
    await ready(a);
    expect((await peer(a, b)).paused).toBe(false);
  });
  it('keeps a local pause while the server is unreachable and reports it later', async () => {
    const { a, b } = await connectPair();
    const mutation = vi.spyOn(a.transport, 'mutation').mockRejectedValue(new TypeError('offline'));
    await a.engine.command({ type: 'pause' });
    mutation.mockRestore();
    expect((await a.store.read()).paused).toBe(true);
    expect((await a.store.read()).pausePending).toBe(true);
    await a.engine.sync();
    expect((await a.store.read()).pausePending).toBeUndefined();
    await ready(b);
    expect((await peer(b, a)).paused).toBe(true);
  });
  it('does not clear a remote pause on Sync now', async () => {
    const { a, b } = await connectPair();
    const target = (await b.store.read()).deviceId!;
    await a.engine.command({ type: 'pauseDevice', deviceId: target, paused: true });
    await b.engine.sync();
    await b.engine.command({ type: 'sync' });
    expect((await b.store.read()).paused).toBe(true);
    await ready(a);
    expect((await peer(a, b)).paused).toBe(true);
  });
  it('shows a peer change made from a paused browser', async () => {
    const { a, b } = await connectPair();
    await a.engine.command({ type: 'pause' });
    await a.engine.command({
      type: 'pauseDevice',
      deviceId: (await b.store.read()).deviceId!,
      paused: true,
    });
    expect((await peer(a, b)).paused).toBe(true);
  });
  it('disconnects another browser and removes it from the collection', async () => {
    const { a, b } = await connectPair();
    await a.native.create({ parentId: '1', title: 'Unsynced', url: 'https://unsynced.example' });
    await a.engine.command({ type: 'revoke', deviceId: (await b.store.read()).deviceId! });
    expect((await peer(a, b)).revoked).toBe(true);
    const acting = await a.store.read();
    expect(acting.outbox).toHaveLength(0);
    expect(acting.snapshot!.nodes.some((n) => n.url === 'https://unsynced.example')).toBe(true);
    await b.engine.sync();
    expect((await b.store.read()).status).toBe('error');
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(1);
  });
  it('disconnects this browser and removes it from the collection', async () => {
    const { a, b } = await connectPair();
    await ready(b);
    const self = (await b.store.read()).deviceId!;
    await expect(b.engine.command({ type: 'revoke', deviceId: self })).rejects.toThrow(
      'Disconnect',
    );
    await b.engine.command({ type: 'disconnect' });
    expect((await b.store.read()).connected).toBe(false);
    expect(b.native.nodes.filter((n) => n.url)).toHaveLength(1);
    await ready(a);
    expect((await a.store.read()).snapshot!.devices.find((d) => d.id === self)?.revoked).toBe(true);
  });
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
