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
    const state = initialState();
    const nodes = await new Adapter(native, true).read(state);
    expect(nodes.find((n) => n.title === 'Menu bookmark')?.parentId).toBe('menu');
    expect(nodes.find((n) => n.kind === 'separator')?.parentId).toBe('toolbar');
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
  it('refuses ambiguous local and account bookmark roots', async () => {
    const native = new MemoryBookmarks([
      { id: '1', title: 'Local', folderType: 'bookmarks-bar', syncing: false },
      { id: '5', title: 'Account', folderType: 'bookmarks-bar', syncing: true },
      { id: '2', title: 'Other', folderType: 'other' },
    ]);
    await expect(new Adapter(native, false).read(initialState())).rejects.toThrow(
      'Multiple local and account',
    );
  });
});
