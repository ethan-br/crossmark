import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Command } from '../apps/extension/src/engine';
import { initialState, type State } from '../apps/extension/src/state';

const commandMock = vi.hoisted(() => vi.fn());

vi.mock('../apps/extension/src/engine', () => ({
  Engine: class {
    run = vi.fn(async () => {});
    sync = vi.fn(async () => {});
    startup = vi.fn(async () => {});
    command = commandMock;
  },
}));

vi.mock('../apps/extension/src/auth', () => ({
  PasswordSession: class {},
}));

import background from '../apps/extension/entrypoints/background';

type MessageEvent = typeof fakeBrowser.runtime.onMessage & {
  trigger: (message: unknown, sender: unknown) => Promise<unknown[]>;
};

/** Mirrors the popup's response unwrapping in `apps/extension/src/main.tsx`. */
async function deliverPopupCommand<T = State>(message: Command): Promise<T> {
  const [raw] = await (fakeBrowser.runtime.onMessage as MessageEvent).trigger(message, {
    id: fakeBrowser.runtime.id,
    url: fakeBrowser.runtime.getURL('popup.html'),
  });
  const result = (await Promise.resolve(raw)) as { data: T; error?: string } | false | undefined;
  if (result === false || result === undefined)
    throw new Error('The background is restarting. Try again.');
  if (result.error) throw new Error(result.error);
  return result.data;
}

describe('background ↔ popup messaging', () => {
  beforeEach(() => {
    commandMock.mockReset();
    commandMock.mockImplementation(async (message: Command) => {
      if (message.type === 'state') return initialState();
      return { ...initialState(), status: 'ready' };
    });
    background.main();
  });

  it('accepts trusted popup commands and returns engine data', async () => {
    const state = await deliverPopupCommand({ type: 'state' });
    expect(state).toMatchObject({ version: 2, status: 'setup' });
    expect(commandMock).toHaveBeenCalledWith({ type: 'state' });
  });

  it('rejects messages from other extensions', async () => {
    const triggered = await (fakeBrowser.runtime.onMessage as MessageEvent).trigger(
      { type: 'state' },
      { id: 'other-extension', url: 'chrome-extension://other/' },
    );
    expect(triggered).toEqual([false]);
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('rejects messages whose sender URL is outside the extension', async () => {
    const triggered = await (fakeBrowser.runtime.onMessage as MessageEvent).trigger(
      { type: 'state' },
      { id: fakeBrowser.runtime.id, url: 'https://evil.example/' },
    );
    expect(triggered).toEqual([false]);
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('ignores unknown command types from the popup URL', async () => {
    const triggered = await (fakeBrowser.runtime.onMessage as MessageEvent).trigger(
      { type: 'not-a-command' },
      { id: fakeBrowser.runtime.id, url: fakeBrowser.runtime.getURL('popup.html') },
    );
    expect(triggered).toEqual([false]);
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('validates connect credentials before calling the engine', async () => {
    const [raw] = await (fakeBrowser.runtime.onMessage as MessageEvent).trigger(
      { type: 'connect', name: 'Chrome', credentials: { email: 1 } },
      { id: fakeBrowser.runtime.id, url: fakeBrowser.runtime.getURL('popup.html') },
    );
    await expect(Promise.resolve(raw)).resolves.toEqual({
      error: 'Invalid connection request.',
    });
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('surfaces engine failures as popup-facing errors', async () => {
    commandMock.mockRejectedValueOnce(new Error('Sign in to continue'));
    await expect(deliverPopupCommand({ type: 'sync' })).rejects.toThrow('Sign in to continue');
  });

  it('updates the action badge from persisted public state', async () => {
    // Simulate a worker revival: empty runtime, then persisted error state.
    fakeBrowser.reset();
    const { installBookmarkMocks, installIdentityMocks, installStorageAccessMocks } =
      await import('./setup/wxt');
    installBookmarkMocks();
    installIdentityMocks();
    installStorageAccessMocks();
    await fakeBrowser.storage.local.set({
      crossmark: { ...initialState(), status: 'error' },
    });
    commandMock.mockReset();
    commandMock.mockResolvedValue(initialState());
    background.main();
    await vi.waitFor(async () => {
      expect(await fakeBrowser.action.getBadgeText({})).toBe('!');
    });
  });
});
