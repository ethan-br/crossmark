import { beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryBookmarks } from '../fixtures/bookmarks';
import type { NativeNode } from '../../apps/extension/src/adapter';

/**
 * WXT's Vitest plugin already stubs global `browser`/`chrome` with fakeBrowser.
 * Extension code imports `webextension-polyfill`, so point that module at the
 * same in-memory implementation.
 */
vi.mock('webextension-polyfill', () => ({
  default: fakeBrowser,
}));

const bookmarkMethods = [
  'getTree',
  'getChildren',
  'get',
  'create',
  'update',
  'move',
  'remove',
] as const;

const bookmarkEvents = [
  'onCreated',
  'onChanged',
  'onMoved',
  'onRemoved',
  'onChildrenReordered',
  'onImportBegan',
  'onImportEnded',
] as const;

/** Chromium-shaped portable roots used by most extension unit tests. */
export const chromiumBookmarkRoots: NativeNode[] = [
  { id: '1', title: 'Bookmarks Bar', folderType: 'bookmarks-bar' },
  { id: '2', title: 'Other Bookmarks', folderType: 'other' },
];

/**
 * Replace unimplemented fake-browser bookmark methods with an in-memory tree.
 * Call after `fakeBrowser.reset()`.
 */
export function installBookmarkMocks(roots: NativeNode[] = chromiumBookmarkRoots) {
  const memory = new MemoryBookmarks(roots);
  for (const method of bookmarkMethods) {
    vi.spyOn(fakeBrowser.bookmarks, method).mockImplementation(((...args: never[]) =>
      (memory[method] as (...a: never[]) => unknown)(...args)) as never);
  }
  for (const event of bookmarkEvents) {
    const target = fakeBrowser.bookmarks[event];
    if (!target) continue;
    vi.spyOn(target, 'addListener').mockImplementation(() => {});
    vi.spyOn(target, 'removeListener').mockImplementation(() => {});
    vi.spyOn(target, 'hasListener').mockImplementation(() => false);
    vi.spyOn(target, 'hasListeners').mockImplementation(() => false);
  }
  return memory;
}

export function installStorageAccessMocks() {
  const local = fakeBrowser.storage.local as typeof fakeBrowser.storage.local & {
    setAccessLevel?: (options: { accessLevel: string }) => Promise<void>;
  };
  if (typeof local.setAccessLevel === 'function') {
    vi.spyOn(local, 'setAccessLevel').mockResolvedValue();
  }
}

beforeEach(() => {
  fakeBrowser.reset();
  installBookmarkMocks();
  installStorageAccessMocks();
});
