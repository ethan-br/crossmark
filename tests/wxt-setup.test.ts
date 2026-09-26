import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { firefoxBookmarkRoots, installBookmarkMocks, installIdentityMocks } from './setup/wxt';

describe('WXT fake-browser setup', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    installBookmarkMocks();
    installIdentityMocks();
  });

  it('persists extension storage without a live profile', async () => {
    await fakeBrowser.storage.local.set({ authSession: { token: 't' } });
    expect(await fakeBrowser.storage.local.get('authSession')).toEqual({
      authSession: { token: 't' },
    });
    await fakeBrowser.storage.local.remove('authSession');
    expect(await fakeBrowser.storage.local.get('authSession')).toEqual({});
  });

  it('routes runtime messages to same-context listeners', async () => {
    const seen: unknown[] = [];
    fakeBrowser.runtime.onMessage.addListener((message) => {
      seen.push(message);
      return Promise.resolve({ data: 'ok' });
    });
    // fake-browser's sendMessage only resolves callback-style `return true` listeners;
    // production webextension-polyfill accepts returned promises, so trigger directly.
    const [raw] = await (
      fakeBrowser.runtime.onMessage as typeof fakeBrowser.runtime.onMessage & {
        trigger: (message: unknown, sender: unknown) => Promise<unknown[]>;
      }
    ).trigger({ type: 'state' }, { id: fakeBrowser.runtime.id });
    await expect(Promise.resolve(raw)).resolves.toEqual({ data: 'ok' });
    expect(seen).toEqual([{ type: 'state' }]);
  });

  it('exposes tabs without launching a browser window', async () => {
    const tabs = await fakeBrowser.tabs.query({});
    expect(Array.isArray(tabs)).toBe(true);
  });

  it('backs bookmarks with an in-memory Chromium tree', async () => {
    const created = await fakeBrowser.bookmarks.create({
      parentId: '1',
      title: 'Native',
      url: 'https://native.example',
    });
    const tree = await fakeBrowser.bookmarks.getTree();
    const toolbar = tree[0]?.children?.find((n) => n.id === '1');
    expect(toolbar?.children?.some((n) => n.id === created.id)).toBe(true);
  });

  it('can install Firefox-shaped bookmark roots for browser-specific tests', async () => {
    installBookmarkMocks(firefoxBookmarkRoots);
    const tree = await fakeBrowser.bookmarks.getTree();
    const ids = (tree[0]?.children ?? []).map((n) => n.id);
    expect(ids).toEqual(['toolbar_____', 'unfiled_____', 'menu________', 'mobile______']);
  });

  it('stubs identity without live OAuth credentials', async () => {
    expect(fakeBrowser.identity.getRedirectURL()).toBe(
      'https://test-extension-id.chromiumapp.org/',
    );
    await expect(fakeBrowser.identity.getAuthToken({ interactive: false })).rejects.toThrow(
      /unused/,
    );
    await expect(
      fakeBrowser.identity.launchWebAuthFlow({
        url: 'https://accounts.example/auth',
        interactive: true,
      }),
    ).rejects.toThrow(/unused/);
  });

  it('supports action badge updates used by the background', async () => {
    await fakeBrowser.action.setBadgeText({ text: '!' });
    expect(await fakeBrowser.action.getBadgeText({})).toBe('!');
  });
});
