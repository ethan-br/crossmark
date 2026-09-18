import { expect, it, vi } from 'vitest';
import { DebugLog } from '../apps/extension/src/debug';
import { configureDebug } from '../apps/extension/src/debug-control';

it('is disabled by default and preserves results and errors without logging', async () => {
  const output = vi.fn();
  const log = new DebugLog('Chromium', output);
  expect(await log.trace('auth.token', async () => 'secret')).toBe('secret');
  await expect(
    log.trace('bookmarks.read', async () => {
      throw new Error('private');
    }),
  ).rejects.toThrow('private');
  expect(output).not.toHaveBeenCalled();
  expect(JSON.parse(log.export()).entries).toEqual([]);
  log.setEnabled(true);
  await log.trace('auth.token', async () => 'secret');
  expect(output).toHaveBeenCalledTimes(2);
  log.setEnabled(false);
  log.event('sync.capture', 'success');
  expect(output).toHaveBeenCalledTimes(2);
});

it('omits sensitive payloads, results and raw errors from representative events', async () => {
  const output = vi.fn();
  const log = new DebugLog('Firefox', output);
  log.setEnabled(true);
  const sensitive = {
    token: 'oauth-secret',
    cookies: 'cookie-secret',
    title: 'Private bookmark',
    url: 'https://private.example',
    email: 'private@example.com',
    requestId: 'secret-id',
    count: 3,
    elapsedMs: Infinity,
    nested: { token: 'nested-secret' },
  };
  log.event('sync.capture', 'success', sensitive as never);
  await log.trace('auth.signIn', async () => sensitive);
  await expect(
    log.trace('bookmarks.write', async () => {
      throw new Error(JSON.stringify(sensitive));
    }),
  ).rejects.toThrow();
  log.event('https://private.example' as never, 'failure');
  const exported = log.export();
  const consoleText = JSON.stringify(output.mock.calls);
  for (const secret of [
    'oauth-secret',
    'cookie-secret',
    'Private bookmark',
    'https://private.example',
    'private@example.com',
    'secret-id',
    'nested-secret',
  ]) {
    expect(exported).not.toContain(secret);
    expect(consoleText).not.toContain(secret);
  }
  const entries = JSON.parse(exported).entries;
  expect(entries).toHaveLength(5);
  expect(entries[0]).toMatchObject({ browser: 'Firefox', runtime: 'background', count: 3 });
  expect(entries[4]).toMatchObject({
    operation: 'bookmarks.write',
    outcome: 'failure',
    requestId: entries[3].requestId,
  });
  expect(entries[4].elapsedMs).toBeGreaterThanOrEqual(0);
});

it('bounds retention, exports snapshots and clears even while operations are running', async () => {
  const log = new DebugLog('Chromium', () => {});
  log.setEnabled(true);
  for (let count = 0; count < 600; count++) log.event('sync.capture', 'success', { count });
  expect(JSON.parse(log.export()).entries).toHaveLength(500);
  expect(JSON.parse(log.export()).entries[0].count).toBe(100);
  let finish!: () => void;
  const pending = log.trace(
    'auth.signIn',
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  log.clear();
  finish();
  await pending;
  expect(JSON.parse(log.export()).entries).toEqual([]);
});

it('does not let console failures change operation results', async () => {
  const log = new DebugLog('Chromium', () => {
    throw new Error('console unavailable');
  });
  log.setEnabled(true);
  expect(await log.trace('bookmarks.write', async () => 42)).toBe(42);
});

it('loads persisted opt-in, follows changes, and supports export/clear while disabled', async () => {
  const log = new DebugLog('Chromium', () => {});
  let listener!: (changes: Record<string, { newValue?: unknown }>, area: string) => void;
  const set = vi.fn(async () => {});
  const { ready, controls } = configureDebug(log, {
    local: { get: async () => ({ crossmarkDebugEnabled: true }), set },
    onChanged: {
      addListener: (fn) => {
        listener = fn;
      },
    },
  });
  await ready;
  log.event('sync.exchange', 'start');
  listener({ crossmarkDebugEnabled: { newValue: false } }, 'sync');
  expect(JSON.parse(controls.export()).enabled).toBe(true);
  listener({ crossmarkDebugEnabled: {} }, 'local');
  log.event('sync.exchange', 'success');
  expect(JSON.parse(controls.export()).entries).toHaveLength(1);
  await controls.setEnabled(true);
  expect(set).toHaveBeenCalledWith({ crossmarkDebugEnabled: true });
  await controls.setEnabled(false);
  controls.clear();
  expect(JSON.parse(controls.export()).entries).toEqual([]);
});

it('does not overwrite a live toggle with a stale initial read and fails closed', async () => {
  const log = new DebugLog('Chromium', () => {});
  let resolve!: (saved: Record<string, unknown>) => void;
  const control = configureDebug(log, {
    local: {
      get: () =>
        new Promise((r) => {
          resolve = r;
        }),
      set: async () => {},
    },
    onChanged: { addListener: (fn) => fn({ crossmarkDebugEnabled: { newValue: false } }, 'local') },
  });
  resolve({ crossmarkDebugEnabled: true });
  await control.ready;
  expect(JSON.parse(log.export()).enabled).toBe(false);
  const failed = configureDebug(log, {
    local: {
      get: async () => {
        throw new Error('storage');
      },
      set: async () => {},
    },
    onChanged: { addListener: () => {} },
  });
  await failed.ready;
  expect(JSON.parse(log.export()).enabled).toBe(false);
});
