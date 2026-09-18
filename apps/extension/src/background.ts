import { debug } from './debug';
import { configureDebug } from './debug-control';
import browser, { type Runtime } from 'webextension-polyfill';
import { GoogleSession } from './auth';
import { Adapter } from './adapter';
import { Engine, type Command } from './engine';
import { initialState, publicState, type State, type Store } from './state';
const diagnostics = configureDebug(debug, browser.storage);
Object.assign(globalThis, { crossmarkDebug: diagnostics.controls });
const store: Store = {
  read: async () => {
    const saved = (await browser.storage.local.get('crossmark')).crossmark as State | undefined;
    if (saved && saved.version === 2) return saved;
    if (saved) {
      const { token: _retired, ...legacy } = saved as unknown as Record<string, unknown>;
      await browser.storage.local.set({ crossmarkLegacy: legacy });
      await browser.storage.local.remove('crossmark');
    }
    return initialState();
  },
  write: async (state) => {
    await browser.storage.local.set({ crossmark: state });
  },
};
const adapter = new Adapter(browser.bookmarks, /Firefox/.test(navigator.userAgent));
const engine = new Engine(
  store,
  adapter,
  import.meta.env.VITE_CONVEX_URL || 'http://127.0.0.1:3210',
  (state) => {
    void badge(state);
  },
  undefined,
  new GoogleSession(
    import.meta.env.VITE_CONVEX_URL || 'http://127.0.0.1:3210',
    import.meta.env.VITE_CONVEX_SITE_URL || 'http://127.0.0.1:3211',
  ),
);
// Queue startup behind the persisted opt-in; listeners still register synchronously.
void engine.run(() => diagnostics.ready);
async function badge(s: State) {
  const text =
    s.status === 'error'
      ? '!'
      : s.paused
        ? 'Ⅱ'
        : s.outbox.length
          ? String(s.outbox.length)
          : s.status === 'syncing'
            ? '↻'
            : '';
  await browser.action.setBadgeText({ text });
  await browser.action.setBadgeBackgroundColor({
    color: s.status === 'error' ? '#b74a3b' : '#247653',
  });
  await browser.action.setTitle({
    title: `Crossmark · ${s.paused ? 'Paused' : s.status === 'ready' ? 'Saved to Crossmark' : s.status} · ${s.outbox.length} pending`,
  });
}
let timer: ReturnType<typeof setTimeout> | undefined;
let importing = false;
function schedule() {
  // Register the durable wake-up before relying on a short debounce.
  void browser.alarms.create('crossmark-reconcile', { delayInMinutes: 0.5 });
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!importing) void engine.sync();
  }, 350);
}
// All listeners are attached synchronously, before storage/network initialization.
browser.bookmarks.onCreated.addListener(schedule);
browser.bookmarks.onChanged.addListener(schedule);
browser.bookmarks.onMoved.addListener(schedule);
browser.bookmarks.onRemoved.addListener(schedule);
(
  browser.bookmarks as typeof browser.bookmarks & {
    onChildrenReordered?: { addListener: (cb: () => void) => void };
  }
).onChildrenReordered?.addListener(schedule);
(
  browser.bookmarks as typeof browser.bookmarks & {
    onImportBegan?: { addListener: (cb: () => void) => void };
  }
).onImportBegan?.addListener(() => {
  importing = true;
});
(
  browser.bookmarks as typeof browser.bookmarks & {
    onImportEnded?: { addListener: (cb: () => void) => void };
  }
).onImportEnded?.addListener(() => {
  importing = false;
  schedule();
});
browser.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('crossmark-')) return;
  await engine.sync();
});
browser.runtime.onStartup.addListener(schedule);
browser.runtime.onInstalled.addListener(schedule);
const commands = new Set([
  'state',
  'connect',
  'sync',
  'pause',
  'approve',
  'disconnect',
  'revoke',
  'restore',
  'export',
]);
browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender) => {
  if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('')))
    return false;
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    !commands.has(String(message.type))
  )
    return false;
  const m = message as Record<string, unknown>;
  if (m.type === 'connect' && typeof m.name !== 'string')
    return Promise.resolve({ error: 'Invalid connection request.' });
  if (
    (m.type === 'revoke' && typeof m.deviceId !== 'string') ||
    (m.type === 'restore' && typeof m.activityId !== 'string')
  )
    return Promise.resolve({ error: 'Invalid command.' });
  return engine.command(message as Command).then(
    (data) => ({ data }),
    (error) => ({
      error: error instanceof Error ? error.message : 'Could not complete this action.',
    }),
  );
});
// Keep credential storage unavailable to content scripts on browsers supporting this API.
const storage = browser.storage.local as typeof browser.storage.local & {
  setAccessLevel?: (options: { accessLevel: string }) => Promise<void>;
};
void storage.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
void browser.alarms.create('crossmark-heartbeat', { periodInMinutes: 0.5 });
void store.read().then((s) => badge(publicState(s)));
void engine.sync();
