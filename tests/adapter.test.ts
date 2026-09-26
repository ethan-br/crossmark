import { describe, it, expect } from 'vitest';
import { Adapter } from '../apps/extension/src/adapter';
import { MemoryBookmarks } from './fixtures/bookmarks';
import { initialState, type Store, type State } from '../apps/extension/src/state';
import type { Node } from '../packages/model';
function storeOf(initial: State) {
  let state = structuredClone(initial);
  const store: Store = {
    read: async () => structuredClone(state),
    write: async (s) => {
      state = structuredClone(s);
    },
  };
  return store;
}
describe('browser projections', () => {
  it('maps Firefox roots by stable ID and preserves separators', async () => {
    const native = new MemoryBookmarks([
      { id: 'toolbar_____', title: 'Localized toolbar' },
      { id: 'unfiled_____', title: 'Localized other' },
      { id: 'menu________', title: 'Localized menu' },
      { id: 'mobile______', title: 'Localized mobile' },
    ]);
    await native.create({
      parentId: 'menu________',
      title: 'Menu bookmark',
      url: 'https://menu.example',
    });
    await native.create({ parentId: 'toolbar_____', title: '', type: 'separator' });
    await native.create({
      parentId: 'mobile______',
      title: 'Mobile only',
      url: 'https://mobile.example',
    });
    const state = initialState();
    const nodes = await new Adapter(native, true).read(state);
    expect(nodes.find((n) => n.title === 'Menu bookmark')?.parentId).toBe('menu');
    expect(nodes.find((n) => n.kind === 'separator')?.parentId).toBe('toolbar');
    expect(nodes.some((n) => n.title === 'Mobile only')).toBe(false);
  });
  it('omits separators only from the Chromium projection', () => {
    const separator: Node = {
      id: 's',
      kind: 'separator',
      parentId: 'toolbar',
      title: '',
      order: 0,
      revision: 1,
    };
    expect(new Adapter(new MemoryBookmarks(), false).projected(separator)).toBe(false);
    expect(new Adapter(new MemoryBookmarks(), true).projected(separator)).toBe(true);
  });
  it('creates one synthetic menu root and refuses to treat its loss as deletions', async () => {
    const native = new MemoryBookmarks();
    const adapter = new Adapter(native, false);
    const state = initialState();
    await adapter.read(state);
    const store = storeOf(state);
    const node: Node = {
      id: 'n',
      kind: 'bookmark',
      parentId: 'menu',
      title: 'Menu bookmark',
      url: 'https://menu.example',
      order: 0,
      revision: 1,
    };
    await adapter.ensureRoots(state, store, [node]);
    expect(state.roots.menu).toBeDefined();
    await adapter.ensureRoots(state, store, [node]);
    expect(native.nodes.filter((n) => n.title === 'Bookmarks Menu')).toHaveLength(1);
    state.connected = true;
    await native.remove(state.roots.menu);
    await expect(adapter.read(state)).rejects.toThrow('mapped bookmark root');
    state.connected = false;
    await expect(adapter.read(state)).resolves.toEqual([]);
    expect(state.roots.menu).toBeUndefined();
  });
  it('selects the account tree and ignores unsupported and managed roots', async () => {
    const native = new MemoryBookmarks([
      { id: '1', title: 'Local', folderType: 'bookmarks-bar', syncing: false },
      { id: '5', title: 'Account', folderType: 'bookmarks-bar', syncing: true },
      { id: '2', title: 'Local other', folderType: 'other', syncing: false },
      { id: '6', title: 'Account other', folderType: 'other', syncing: true },
      { id: '7', title: 'Speed Dial' },
      { id: '8', title: 'Policy', folderType: 'managed', unmodifiable: 'managed' },
    ]);
    await native.create({ parentId: '1', title: 'Local only', url: 'https://local.example' });
    await native.create({ parentId: '5', title: 'Account only', url: 'https://account.example' });
    await native.create({ parentId: '7', title: 'Opera only', url: 'https://opera.example' });
    const state = initialState();
    const nodes = await new Adapter(native, false).read(state);
    expect(state.roots).toMatchObject({ toolbar: '5', other: '6' });
    expect(nodes.map((n) => n.title)).toEqual(['Account only']);
  });
  it('adopts an existing menu folder and remaps changed root IDs', async () => {
    const native = new MemoryBookmarks();
    const menu = await native.create({ parentId: '2', title: 'Bookmarks Menu' });
    await native.create({ parentId: menu.id, title: 'Saved', url: 'https://saved.example' });
    const state = initialState();
    const adapter = new Adapter(native, false);
    const first = await adapter.read(state);
    expect(state.roots.menu).toBe(menu.id);
    expect(first).toHaveLength(1);
    expect(first[0].parentId).toBe('menu');
    state.connected = true;
    state.rootSignature = 'old ID-based signature';
    native.nodes.find((n) => n.id === '1')!.id = '10';
    native.nodes.find((n) => n.id === '2')!.id = '20';
    native.nodes.find((n) => n.id === menu.id)!.parentId = '20';
    const second = await adapter.read(state);
    expect(state.roots).toMatchObject({ toolbar: '10', other: '20', menu: menu.id });
    expect(second).toEqual(first);
  });
  it('pauses if a selected account tree disappears while a local tree remains', async () => {
    const native = new MemoryBookmarks([
      { id: '1', title: 'Local toolbar', folderType: 'bookmarks-bar', syncing: false },
      { id: '2', title: 'Local other', folderType: 'other', syncing: false },
      { id: '5', title: 'Account toolbar', folderType: 'bookmarks-bar', syncing: true },
      { id: '6', title: 'Account other', folderType: 'other', syncing: true },
    ]);
    const state = initialState();
    const adapter = new Adapter(native, false);
    await adapter.read(state);
    state.connected = true;
    native.nodes = native.nodes.filter((n) => n.id !== '5' && n.id !== '6');
    await expect(adapter.read(state)).rejects.toThrow(
      'selected bookmark collection is unavailable',
    );
  });
  it('reselects live roots before connecting when an account tree disappears', async () => {
    const native = new MemoryBookmarks([
      { id: '1', title: 'Local toolbar', folderType: 'bookmarks-bar', syncing: false },
      { id: '2', title: 'Local other', folderType: 'other', syncing: false },
      { id: '5', title: 'Account toolbar', folderType: 'bookmarks-bar', syncing: true },
      { id: '6', title: 'Account other', folderType: 'other', syncing: true },
    ]);
    const state = initialState();
    const adapter = new Adapter(native, false);
    await adapter.read(state);
    expect(state.roots.toolbar).toBe('5');
    native.nodes = native.nodes.filter((n) => n.id !== '5' && n.id !== '6');
    await expect(adapter.read(state)).resolves.toEqual([]);
    expect(state.roots).toMatchObject({ toolbar: '1', other: '2' });
  });
  it('keeps a legacy local selection after its IDs change alongside account roots', async () => {
    const native = new MemoryBookmarks([
      { id: '10', title: 'Local toolbar', folderType: 'bookmarks-bar', syncing: false },
      { id: '20', title: 'Local other', folderType: 'other', syncing: false },
      { id: '5', title: 'Account toolbar', folderType: 'bookmarks-bar', syncing: true },
      { id: '6', title: 'Account other', folderType: 'other', syncing: true },
    ]);
    const state = initialState();
    state.connected = true;
    state.roots = { toolbar: '1', other: '2' };
    state.rootSignature = JSON.stringify([
      ['1', 'bookmarks-bar', false],
      ['2', 'other', false],
      ['5', 'bookmarks-bar', true],
      ['6', 'other', true],
    ]);
    await new Adapter(native, false).read(state);
    expect(state.roots).toEqual({ toolbar: '10', other: '20' });
    expect(state.rootSyncing).toEqual({ toolbar: false, other: false });
  });
  it('keeps a renamed and moved legacy mobile wrapper out of the portable tree', async () => {
    const native = new MemoryBookmarks();
    const wrapper = await native.create({ parentId: '2', title: 'Mobile Bookmarks' });
    await native.create({
      parentId: wrapper.id,
      title: 'Phone link',
      url: 'https://phone.example',
    });
    const state = initialState();
    state.roots.mobile = wrapper.id;
    const adapter = new Adapter(native, false);
    await native.update(wrapper.id, { title: 'My phone' });
    await native.move(wrapper.id, { parentId: '1' });
    expect(await adapter.read(state)).toEqual([]);
    expect(state.roots.mobile).toBe(wrapper.id);
    expect(native.nodes.find((n) => n.url === 'https://phone.example')).toBeDefined();
  });
  it('does not create a mobile folder for mobile-only cloud content', async () => {
    const native = new MemoryBookmarks();
    const state = initialState();
    const adapter = new Adapter(native, false);
    await adapter.read(state);
    await adapter.ensureRoots(state, storeOf(state), [
      {
        id: 'm',
        kind: 'bookmark',
        parentId: 'mobile',
        title: 'Phone',
        url: 'https://phone.example',
        order: 0,
        revision: 1,
      },
    ]);
    expect(native.nodes).toHaveLength(2);
    expect(state.roots.mobile).toBeUndefined();
  });
});
