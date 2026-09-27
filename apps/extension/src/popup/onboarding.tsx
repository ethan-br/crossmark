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

function Field({
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

function Welcome({ onChoose }: { onChoose: (create: boolean) => void }) {
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
          Sync native bookmarks between your desktop browsers.
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
  const title = create ? 'Create account' : 'Sign in';
  async function submit(e: FormEvent) {
    e.preventDefault();
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
          {busy ? (create ? 'Creating account…' : 'Signing in…') : title}
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
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete={create ? 'new-password' : 'current-password'}
        required
        minLength={create ? 8 : undefined}
        maxLength={128}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
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
  const stats = count(state.baseline);
  return (
    <Screen
      onSubmit={(e) => {
        e.preventDefault();
        void act({ type: 'connect', name });
      }}
      actions={
        <>
          <Button variant={replaces ? 'destructive' : 'default'} disabled={busy}>
            {busy ? 'Syncing…' : replaces ? 'Overwrite and sync' : 'Start syncing'}
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
          {replaces ? 'Replace this browser’s bookmarks?' : 'Start syncing?'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {replaces
            ? `${state.account?.email} already has synced bookmarks. They replace the bookmarks in this browser.`
            : `This browser’s bookmarks become the collection for ${state.account?.email}.`}
        </p>
      </div>
      <Stats bookmarks={stats.bookmarks} folders={stats.folders}>
        {replaces ? (
          <span className="text-destructive">will be overwritten</span>
        ) : (
          'will be synced'
        )}
      </Stats>
      {replaces && (
        <p className="text-xs text-muted-foreground">
          A copy is kept and can be exported from Settings.
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
}: {
  state: State;
  busy: boolean;
  act: Act;
  onNavigate: () => void;
  onCancelReauth: () => void;
}) {
  const [mode, setMode] = useState<'welcome' | 'signIn' | 'create'>(
    state.connected ? 'signIn' : 'welcome',
  );
  function go(next: typeof mode) {
    onNavigate();
    setMode(next);
  }
  if (state.connected)
    return (
      <AccountForm state={state} busy={busy} act={act} create={false} onBack={onCancelReauth} />
    );
  if (state.account && state.collectionExists !== undefined)
    return <ConfirmSync state={state} busy={busy} act={act} onCancel={() => go('welcome')} />;
  if (mode === 'welcome')
    return <Welcome onChoose={(create) => go(create ? 'create' : 'signIn')} />;
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
