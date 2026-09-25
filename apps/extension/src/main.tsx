import React, { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';
import {
  BookmarkCheck,
  Settings2,
  Check,
  Cloud,
  RefreshCw,
  Pause,
  Play,
  CloudOff,
  KeyRound,
  ChevronRight,
  BookmarkPlus,
  FolderInput,
  Trash2,
  Globe,
  ArrowLeft,
  UserRound,
  Download,
  X,
  Info,
  LoaderCircle,
  LogOut,
} from 'lucide-react';
import { type Activity, count } from '../../../packages/model';
import { type State, initialState } from './state';
import type { Command } from './engine';
import packageJson from '../../../package.json';
import './styles.css';
async function command<T = State>(message: Command): Promise<T> {
  const result = (await browser.runtime.sendMessage(message)) as
    { data: T; error?: string } | undefined;
  if (!result) throw new Error('The background is restarting. Try again.');
  if (result.error) throw new Error(result.error);
  return result.data;
}
function relative(time?: number) {
  if (!time) return 'Never';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  return seconds < 60
    ? `${seconds}s ago`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ago`
        : `${Math.floor(seconds / 86400)}d ago`;
}
const activityLines: Record<Activity['kind'], { icon: typeof Check; verb: string }> = {
  added: { icon: BookmarkPlus, verb: 'added' },
  removed: { icon: Trash2, verb: 'removed' },
  moved: { icon: FolderInput, verb: 'moved' },
  synced: { icon: RefreshCw, verb: 'synced' },
};
function App() {
  const [state, setState] = useState<State>(initialState());
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [create, setCreate] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    command: Command;
    label: string;
  }>();
  const [, tick] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await command({ type: 'state' });
        if (active) {
          setState(next);
          setLoaded(true);
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : String(e));
          setLoaded(true);
        }
      }
    };
    void refresh();
    const listener = (_changes: unknown, area: string) => {
      if (area === 'local') void refresh();
    };
    browser.storage.onChanged.addListener(listener);
    const time = setInterval(() => tick((t) => t + 1), 1000);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(listener);
      clearInterval(time);
    };
  }, []);
  useEffect(() => {
    if (!confirm) return;
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus();
  }, [confirm]);
  async function act(message: Command) {
    setBusy(true);
    setError('');
    try {
      setState(await command(message));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function login(e: FormEvent) {
    e.preventDefault();
    const signingUp = create && !state.connected;
    const ok = await act({
      type: 'connect',
      name: name || state.name,
      credentials: { email: email || state.account?.email || '', password, create: signingUp },
    });
    if (ok) {
      setPassword('');
      setReauth(false);
    }
  }
  async function exportData() {
    try {
      const data = await command({ type: 'export' });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `crossmark-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(String(e));
    }
  }
  const status = state.paused ? 'paused' : state.status;
  const stats = count(state.baseline);
  const pending = state.outbox.length;
  const browsers = state.snapshot?.devices.filter((d) => !d.revoked) ?? [];
  // Snapshots cached by earlier versions can hold activity kinds that are no longer shown.
  const activity = (state.snapshot?.activity ?? []).filter((e) =>
    Object.hasOwn(activityLines, e.kind),
  );
  const details = {
    ready: {
      icon: Check,
      title: 'Up to date',
      description: 'No local changes pending.',
      connection: 'Connected',
    },
    syncing: {
      icon: RefreshCw,
      title: 'Syncing',
      description: pending ? `${pending} changes pending upload.` : 'Checking for changes.',
      connection: 'Syncing',
    },
    paused: {
      icon: Pause,
      title: 'Sync paused',
      description: `${pending} local changes pending.`,
      connection: 'Paused',
    },
    offline: {
      icon: CloudOff,
      title: 'Offline',
      description: `${pending} local changes waiting for a connection.`,
      connection: 'Offline',
    },
    error: {
      icon: KeyRound,
      title: state.needsSignIn ? 'Sign-in required' : 'Sync failed',
      description: `${pending} local changes pending.`,
      connection: 'Error',
    },
    review: {
      icon: FolderInput,
      title: 'Review pending changes',
      description: `${state.reviewCount ?? pending} items require approval.`,
      connection: 'Review required',
    },
    setup: {
      icon: KeyRound,
      title: 'Not signed in',
      description: 'Sign in to sync bookmarks.',
      connection: 'Not signed in',
    },
  }[status];
  const StatusIcon = details.icon;
  function eventRow(event: Activity) {
    const { icon: Icon, verb } = activityLines[event.kind];
    return (
      <div className="cm-event" key={event.id}>
        <span className="cm-event-icon">
          <Icon />
        </span>
        <div className="cm-event-text cm-item-title">
          {event.title || 'Untitled'} {verb}
        </div>
        <time className="cm-time">{relative(event.at)}</time>
      </div>
    );
  }
  return (
    <div id="cm-extension-mock">
      <section className="cm-window" aria-label="Crossmark extension popup">
        <header className="cm-header">
          <div className="cm-brand">
            <BookmarkCheck />
          </div>
          <div className="cm-wordmark">crossmark</div>
          {state.connected && (
            <button
              className="cm-icon-button"
              aria-label="Open settings"
              aria-expanded={tab === 'settings'}
              onClick={() => setTab(tab === 'settings' ? 'overview' : 'settings')}
            >
              <Settings2 />
            </button>
          )}
        </header>
        {state.connected && (
          <nav className="cm-tabs" aria-label="Extension navigation">
            {['overview', 'activity', 'browsers'].map((t) => (
              <button
                key={t}
                className="cm-tab"
                aria-current={tab === t ? 'page' : undefined}
                onClick={() => setTab(t)}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </nav>
        )}
        <main aria-busy={busy || !loaded}>
          {(error || state.error) && (
            <div className="cm-error" role="alert">
              <Info />
              <span>{error || state.error}</span>
              {error && (
                <button
                  className="cm-icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setError('')}
                >
                  <X />
                </button>
              )}
            </div>
          )}
          {!loaded ? (
            <div className="cm-loading">
              <LoaderCircle className="spin" />
              Loading sync status
            </div>
          ) : !state.connected || reauth ? (
            <section className="cm-content" aria-label="Sign in">
              <h2 className="cm-panel-title">
                {create && !state.connected ? 'Create account' : 'Sign in'}
              </h2>
              <p className="cm-intro">Use the same account in each browser.</p>
              <form onSubmit={login}>
                <label className="cm-label" htmlFor="email">
                  Email
                </label>
                <input
                  className="cm-input"
                  id="email"
                  type="email"
                  autoComplete="email"
                  required={!state.account}
                  placeholder={state.account?.email}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <label className="cm-label" htmlFor="password">
                  Password
                </label>
                <input
                  className="cm-input"
                  id="password"
                  type="password"
                  autoComplete={create ? 'new-password' : 'current-password'}
                  required
                  minLength={create ? 8 : undefined}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {!state.connected && (
                  <>
                    <label className="cm-label" htmlFor="browser-name">
                      Browser name
                    </label>
                    <input
                      className="cm-input"
                      id="browser-name"
                      placeholder={state.name}
                      value={name}
                      maxLength={80}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <div className="cm-source">
                      <FolderInput />
                      <span>
                        {stats.bookmarks} bookmarks · {stats.folders} folders in this browser
                      </span>
                    </div>
                    <p className="cm-secondary cm-source-note">
                      Your first installation initializes the collection. Additional browsers
                      require approval before merging existing bookmarks.
                    </p>
                  </>
                )}
                <div className="cm-actions">
                  <button className="cm-primary" disabled={busy}>
                    {busy ? <LoaderCircle className="spin" /> : <KeyRound />}
                    {busy
                      ? 'Signing in…'
                      : create && !state.connected
                        ? 'Create account'
                        : 'Sign in'}
                  </button>
                  {reauth && state.connected && (
                    <button
                      type="button"
                      className="cm-secondary-button"
                      onClick={() => setReauth(false)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
              {!state.connected && (
                <p className="cm-fineprint">
                  {create ? 'Already have an account? ' : 'New to Crossmark? '}
                  <button type="button" className="cm-link" onClick={() => setCreate(!create)}>
                    {create ? 'Sign in' : 'Create an account'}
                  </button>
                  . Crossmark’s server can read bookmark data.
                </p>
              )}
            </section>
          ) : (
            <>
              {tab === 'overview' && (
                <section className="cm-content" aria-label="Sync overview">
                  <div
                    className={`cm-status ${['error', 'offline', 'paused', 'review'].includes(status) ? 'cm-status-warm' : ''}`}
                    role="status"
                    aria-live="polite"
                  >
                    <div className="cm-status-top">
                      <span className="cm-check">
                        <StatusIcon className={status === 'syncing' ? 'spin' : ''} />
                      </span>
                      <span className="cm-status-label">This browser</span>
                    </div>
                    <h2>{details.title}</h2>
                    <p className="cm-state-desc">{details.description}</p>
                    <div className="cm-status-bottom">
                      <Cloud />
                      <span>Last successful sync: {relative(state.lastSync)}</span>
                    </div>
                  </div>
                  <div className="cm-stats">
                    <strong>{stats.bookmarks}</strong> bookmarks<span className="cm-dot">·</span>
                    <strong>{stats.folders}</strong> folders<span className="cm-dot">·</span>
                    {state.name}
                  </div>
                  {status === 'review' ? (
                    <div className="cm-permission">
                      <div className="cm-item-title">Approve changes</div>
                      <p>
                        {`${pending} pending operations will update your other browsers. Export includes the operations and the previous snapshot.`}
                      </p>
                      <p>A recovery snapshot is saved before applying changes.</p>
                      <div className="cm-actions">
                        <button className="cm-secondary-button" onClick={exportData}>
                          <Download />
                          Export
                        </button>
                        <button
                          className="cm-primary"
                          disabled={busy}
                          onClick={() => act({ type: 'approve' })}
                        >
                          <Check />
                          Approve
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="cm-section-title">
                        Recent changes
                        <button className="cm-link" onClick={() => setTab('activity')}>
                          View all
                          <ChevronRight />
                        </button>
                      </div>
                      {activity.length ? (
                        activity.slice(0, 2).map((e) => eventRow(e))
                      ) : (
                        <p className="cm-empty">No changes recorded.</p>
                      )}
                      <div className="cm-actions">
                        <button
                          className="cm-primary"
                          disabled={
                            busy || status === 'syncing' || (state.paused && !state.needsSignIn)
                          }
                          onClick={() =>
                            state.needsSignIn ? setReauth(true) : act({ type: 'sync' })
                          }
                        >
                          {state.needsSignIn ? (
                            <KeyRound />
                          ) : (
                            <RefreshCw className={status === 'syncing' ? 'spin' : ''} />
                          )}
                          {state.needsSignIn
                            ? 'Sign in'
                            : status === 'syncing'
                              ? 'Syncing…'
                              : 'Sync now'}
                        </button>
                        <button
                          className="cm-secondary-button"
                          aria-pressed={state.paused}
                          disabled={busy}
                          onClick={() => act({ type: 'pause' })}
                        >
                          {state.paused ? <Play /> : <Pause />}
                          {state.paused ? 'Resume' : 'Pause'}
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}
              {tab === 'activity' && (
                <section className="cm-content" aria-label="Bookmark activity">
                  <h2 className="cm-panel-title">Activity</h2>
                  <p className="cm-intro">Recent bookmark changes and syncs.</p>
                  {activity.length ? (
                    activity.map((e) => eventRow(e))
                  ) : (
                    <p className="cm-empty">No changes recorded.</p>
                  )}
                </section>
              )}
              {tab === 'browsers' && (
                <section className="cm-content" aria-label="Connected browsers">
                  <h2 className="cm-panel-title">Connected browsers</h2>
                  {browsers.map((d) => {
                    const self = d.id === state.deviceId;
                    const paused = self ? state.paused : d.paused;
                    const lastSync = self ? state.lastSync : d.lastSeen;
                    return (
                      <div className="cm-browser-row" key={d.id}>
                        <span className="cm-browser-symbol">
                          <Globe />
                        </span>
                        <div className="cm-event-text">
                          <div className="cm-item-title">
                            {d.name}
                            {self && <span className="cm-tag">This browser</span>}
                          </div>
                          <div className="cm-secondary">
                            {paused
                              ? 'Paused'
                              : self && status !== 'ready'
                                ? details.title
                                : lastSync
                                  ? `Last synced ${relative(lastSync)}`
                                  : 'Not synced yet'}
                          </div>
                        </div>
                        <div className="cm-browser-actions">
                          <button
                            className="cm-link"
                            aria-label={`${paused ? 'Resume' : 'Pause'} ${d.name}`}
                            disabled={busy}
                            onClick={() =>
                              act({ type: 'pauseDevice', deviceId: d.id, paused: !paused })
                            }
                          >
                            {paused ? <Play /> : <Pause />}
                            {paused ? 'Resume' : 'Pause'}
                          </button>
                          <button
                            className="cm-link cm-remove"
                            aria-label={`Disconnect ${d.name}`}
                            disabled={busy}
                            onClick={() =>
                              setConfirm(
                                self
                                  ? {
                                      title: 'Disconnect this browser?',
                                      body: 'This browser stops syncing, is removed from your connected browsers, and signs out. Its bookmarks stay here. Sign in again to reconnect.',
                                      command: { type: 'disconnect' },
                                      label: 'Disconnect',
                                    }
                                  : {
                                      title: `Disconnect ${d.name}?`,
                                      body: `${d.name} stops syncing and is removed from your connected browsers. Its bookmarks stay in that browser. To reconnect it, sign out and sign in again on that browser.`,
                                      command: { type: 'revoke', deviceId: d.id },
                                      label: 'Disconnect',
                                    },
                              )
                            }
                          >
                            <X />
                            Disconnect
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <p className="cm-note">
                    Other browsers pick up a pause or disconnect the next time they sync.
                  </p>
                  <div className="cm-permission">
                    <div className="cm-item-title">Connect another browser</div>
                    <p>Install Crossmark and sign in with {state.account?.email}.</p>
                  </div>
                </section>
              )}
              {tab === 'settings' && (
                <section className="cm-content" aria-label="Extension settings">
                  <button className="cm-back" onClick={() => setTab('overview')}>
                    <ArrowLeft />
                    Overview
                  </button>
                  <h2 className="cm-panel-title">Settings</h2>
                  <div className="cm-setting">
                    <div className="cm-setting-copy">
                      <div className="cm-item-title">Account</div>
                      <p className="cm-secondary">{state.account?.email}</p>
                    </div>
                  </div>
                  <label className="cm-setting">
                    <div className="cm-setting-copy">
                      <div className="cm-item-title">Automatic sync</div>
                      <p className="cm-secondary">
                        Sync native bookmark changes from this browser.
                      </p>
                    </div>
                    <input
                      className="cm-switch"
                      type="checkbox"
                      role="switch"
                      aria-label="Automatic sync"
                      checked={!state.paused}
                      disabled={busy}
                      onChange={() => act({ type: 'pause' })}
                    />
                  </label>
                  <button className="cm-setting-button" onClick={exportData}>
                    <Download />
                    <span>
                      <strong>Export bookmarks and recovery</strong>
                      <small>Collection, recovery snapshot and pending changes as JSON.</small>
                    </span>
                    <ChevronRight />
                  </button>
                  <button
                    className="cm-setting-button"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        title: 'Sign out?',
                        body: 'Sync pending changes before signing out. Native bookmarks remain in this browser. Sign in with the same account to reconnect.',
                        command: { type: 'disconnect' },
                        label: 'Sign out',
                      })
                    }
                  >
                    <LogOut />
                    <span>
                      <strong>Sign out</strong>
                      <small>Stop sync and end this installation’s session.</small>
                    </span>
                    <ChevronRight />
                  </button>
                  <p className="cm-fineprint">
                    v{packageJson.version} · Native changes trigger sync. Remote changes are checked
                    every 30 seconds while the browser is running. Bookmark data is not end-to-end
                    encrypted.
                  </p>
                </section>
              )}
            </>
          )}
          {confirm && (
            <div
              className="cm-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setConfirm(undefined);
                if (e.key === 'Tab') {
                  const buttons =
                    e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
                  const first = buttons[0],
                    last = buttons[buttons.length - 1];
                  if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                  } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                  }
                }
              }}
            >
              <div className="cm-permission">
                <h2 className="cm-panel-title" id="confirm-title">
                  {confirm.title}
                </h2>
                <p>{confirm.body}</p>
                <div className="cm-actions">
                  <button
                    autoFocus
                    className="cm-secondary-button"
                    onClick={() => setConfirm(undefined)}
                  >
                    Cancel
                  </button>
                  <button
                    className="cm-primary"
                    disabled={busy}
                    onClick={async () => {
                      if (await act(confirm.command)) setConfirm(undefined);
                    }}
                  >
                    {confirm.label}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
        <footer className="cm-footer">
          <span className="cm-avatar">
            <UserRound />
          </span>
          <span className="cm-account">{state.account?.email ?? 'Not signed in'}</span>
          <span className="cm-footer-tail">
            <span className={`cm-dot-live ${status === 'ready' ? '' : 'muted'}`} />
            {details.connection}
          </span>
        </footer>
      </section>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
