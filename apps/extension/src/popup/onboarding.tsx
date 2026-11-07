import type { Confirmation } from './browsers';
import { restoreConfirmation } from './shared';
import { useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { count } from '../../../../packages/model';
import type { Command } from '../engine';
import type { State } from '../state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Stats } from './parts';

type Act = (message: Command) => Promise<boolean>;

function Screen({
  children,
  actions,
  onSubmit,
}: {
  children: ReactNode;
  actions: ReactNode;
  onSubmit?: (e: FormEvent) => void;
}) {
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={onSubmit ?? ((e) => e.preventDefault())}
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4 pt-2">{children}</div>
      </ScrollArea>
      <div className="flex shrink-0 flex-col gap-2 p-4">{actions}</div>
    </form>
  );
}

export function Field({
  id,
  label,
  ...props
}: { id: string; label: string } & ComponentProps<typeof Input>) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  );
}

function Welcome({
  onChoose,
  onRestore,
}: {
  onChoose: (create: boolean) => void;
  onRestore?: () => void;
}) {
  return (
    <Screen
      actions={
        <>
          <Button type="button" onClick={() => onChoose(false)}>
            Sign in
          </Button>
          <Button type="button" variant="outline" onClick={() => onChoose(true)}>
            Create account
          </Button>
          {onRestore && (
            <Button type="button" variant="outline" onClick={onRestore}>
              Restore pre-Crossmark bookmarks
            </Button>
          )}
          <p className="pt-1 text-center text-[11px] text-muted-foreground">
            Crossmark’s server can read bookmark data.
          </p>
        </>
      }
    >
      <div className="flex flex-col gap-2 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Your bookmarks,
          <br />
          <span className="text-primary">in every browser.</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Keep your bookmarks in sync between your desktop browsers.
        </p>
      </div>
    </Screen>
  );
}

function AccountForm({
  state,
  busy,
  act,
  create,
  onBack,
}: {
  state: State;
  busy: boolean;
  act: Act;
  create: boolean;
  onBack: () => void;
}) {
  const reauth = state.connected;
  const [email, setEmail] = useState(reauth ? (state.account?.email ?? '') : '');
  const [password, setPassword] = useState('');
  const [reset, setReset] = useState(false);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const title = reset ? 'Reset password' : create ? 'Create account' : 'Sign in';
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (reset) {
      if (!sent) {
        if (await act({ type: 'requestReset', email })) setSent(true);
      } else if (await act({ type: 'resetPassword', token: code, password })) {
        setReset(false);
        setSent(false);
        setCode('');
        setPassword('');
      }
      return;
    }
    if (await act({ type: 'signIn', credentials: { email, password, create } })) {
      setPassword('');
      if (reauth) onBack();
    }
  }
  return (
    <Screen
      onSubmit={submit}
      actions={
        <Button disabled={busy}>
          {reset
            ? sent
              ? 'Set password'
              : 'Email reset code'
            : busy
              ? create
                ? 'Creating account…'
                : 'Signing in…'
              : title}
        </Button>
      }
    >
      <div className="-ml-2 flex items-center gap-1">
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Back" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        readOnly={reauth}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {reset && sent && (
        <>
          <p className="text-xs text-muted-foreground">
            If an account exists, a reset code has been emailed. Paste it below. It expires in 30
            minutes.
          </p>
          <Field
            id="reset-code"
            label="Reset code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </>
      )}
      {(!reset || sent) && (
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete={create || reset ? 'new-password' : 'current-password'}
          required
          minLength={create || reset ? 8 : undefined}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      {!create && (
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setReset(!reset);
            setSent(false);
            setPassword('');
            setCode('');
          }}
        >
          {reset ? 'Return to sign in' : 'Forgot password?'}
        </Button>
      )}
    </Screen>
  );
}

function ConfirmSync({
  state,
  busy,
  act,
  onCancel,
}: {
  state: State;
  busy: boolean;
  act: Act;
  onCancel: () => void;
}) {
  const [name, setName] = useState(state.name);
  const replaces = state.collectionExists;
  const [choice, setChoice] = useState<'remote' | 'local' | ''>(
    state.connectionChoice ?? (replaces ? '' : 'local'),
  );
  const [confirmed, setConfirmed] = useState(false);
  const stats = count(state.baseline);
  return (
    <Screen
      onSubmit={(e) => {
        e.preventDefault();
        if (choice && (!replaces || confirmed)) void act({ type: 'connect', name, choice });
      }}
      actions={
        <>
          <Button
            variant={replaces ? 'destructive' : 'default'}
            disabled={busy || !choice || (!!replaces && !confirmed)}
          >
            {busy
              ? 'Syncing…'
              : replaces
                ? choice === 'local'
                  ? 'Replace account bookmarks'
                  : 'Replace this browser’s bookmarks'
                : 'Start syncing'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              if (await act({ type: 'disconnect' })) onCancel();
            }}
          >
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight">
          {replaces ? 'Which bookmarks should you use?' : 'Start syncing?'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {replaces
            ? `${state.account?.email} already has synced bookmarks. Choose which bookmarks to keep. The two sets will not be combined.`
            : `This browser’s bookmarks become the synced bookmarks for ${state.account?.email}.`}
        </p>
      </div>
      <Stats bookmarks={stats.bookmarks} folders={stats.folders}>
        in this browser
      </Stats>
      {replaces && (
        <>
          <fieldset className="flex flex-col gap-3" disabled={busy || state.registrationPending}>
            <legend className="mb-2 text-sm font-medium">Bookmarks to keep</legend>
            <label className="flex items-start gap-2 rounded border p-3 text-sm">
              <input
                type="radio"
                name="connection-choice"
                value="remote"
                checked={choice === 'remote'}
                onChange={() => {
                  setChoice('remote');
                  setConfirmed(false);
                }}
              />
              <span>
                Use synced bookmarks
                <span className="mt-1 block text-xs text-muted-foreground">
                  Replace this browser’s bookmarks with the account’s synced bookmarks. Your
                  original pre-Crossmark bookmarks stay saved for Disconnect and restore.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded border p-3 text-sm">
              <input
                type="radio"
                name="connection-choice"
                value="local"
                checked={choice === 'local'}
                onChange={() => {
                  setChoice('local');
                  setConfirmed(false);
                }}
              />
              <span>
                Use this browser’s bookmarks
                <span className="mt-1 block text-xs text-muted-foreground">
                  Replace the account’s synced bookmarks with this browser’s bookmarks. This also
                  replaces bookmarks on all other connected browsers.
                </span>
              </span>
            </label>
          </fieldset>
          {!!choice && (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {choice === 'local'
                ? 'I understand this replaces bookmarks on all connected browsers.'
                : 'I understand this replaces the bookmarks in this browser.'}
            </label>
          )}
        </>
      )}
      {state.registrationPending && !busy && (
        <p className="text-xs text-muted-foreground">
          Crossmark could not confirm whether connecting finished. Retry with the same bookmarks
          selected, or Cancel to choose again. Cancel needs a connection to the Crossmark server and
          does not undo bookmarks already replaced in the account.
        </p>
      )}
      <Field
        id="browser-name"
        label="Browser name"
        required
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </Screen>
  );
}

export function Onboarding({
  state,
  busy,
  act,
  onNavigate,
  onCancelReauth,
  confirm,
}: {
  state: State;
  busy: boolean;
  act: Act;
  onNavigate: () => void;
  onCancelReauth: () => void;
  confirm: (confirmation: Confirmation) => void;
}) {
  const [mode, setMode] = useState<'welcome' | 'signIn' | 'create'>(
    state.connected ? 'signIn' : 'welcome',
  );
  function go(next: typeof mode) {
    onNavigate();
    setMode(next);
  }
  if (state.restorePending)
    return (
      <Screen
        actions={
          <Button disabled={busy} onClick={() => void act({ type: 'restore', confirmed: true })}>
            Retry restore
          </Button>
        }
      >
        <h2 className="text-lg font-semibold">Restoring pre-Crossmark bookmarks</h2>
        <p className="text-sm text-muted-foreground">
          This browser is disconnected. If restoration was interrupted, retry to finish. Restored
          bookmarks will not sync to the account.
        </p>
      </Screen>
    );
  if (state.connected)
    return (
      <AccountForm state={state} busy={busy} act={act} create={false} onBack={onCancelReauth} />
    );
  if (state.account && state.collectionExists !== undefined)
    return <ConfirmSync state={state} busy={busy} act={act} onCancel={() => go('welcome')} />;
  if (mode === 'welcome')
    return (
      <Welcome
        onChoose={(create) => go(create ? 'create' : 'signIn')}
        onRestore={
          state.joinRecovery !== undefined ? () => confirm(restoreConfirmation) : undefined
        }
      />
    );
  return (
    <AccountForm
      key={mode}
      state={state}
      busy={busy}
      act={act}
      create={mode === 'create'}
      onBack={() => go('welcome')}
    />
  );
}
