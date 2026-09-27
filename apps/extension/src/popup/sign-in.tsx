import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { count } from '../../../../packages/model';
import type { Command } from '../engine';
import type { State } from '../state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SignIn({
  state,
  busy,
  act,
  reauth,
  onCancel,
}: {
  state: State;
  busy: boolean;
  act: (message: Command) => Promise<boolean>;
  reauth: boolean;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [create, setCreate] = useState(false);
  const signingUp = create && !state.connected;
  const stats = count(state.baseline);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await act({
      type: 'connect',
      name: name || state.name,
      credentials: { email: email || state.account?.email || '', password, create: signingUp },
    });
    if (ok) {
      setPassword('');
      onCancel();
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">
        {signingUp ? 'Create account' : 'Sign in'}
      </h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required={!state.account}
          placeholder={state.account?.email}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete={create ? 'new-password' : 'current-password'}
          required
          minLength={create ? 8 : undefined}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {!state.connected && (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="browser-name">Browser name</Label>
            <Input
              id="browser-name"
              placeholder={state.name}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <p className="cm-source-note text-xs text-muted-foreground">
            The first browser saves its bookmarks to the collection. If this account already has a
            collection, signing in replaces these {stats.bookmarks} bookmarks and {stats.folders}{' '}
            folders with it.
          </p>
        </>
      )}
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy}>
          {busy && <LoaderCircle className="animate-spin" />}
          {busy ? 'Signing in…' : signingUp ? 'Create account' : 'Sign in'}
        </Button>
        {reauth && state.connected && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {!state.connected && (
        <p className="text-xs text-muted-foreground">
          {create ? 'Already have an account? ' : 'New to Crossmark? '}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => setCreate(!create)}
          >
            {create ? 'Sign in' : 'Create an account'}
          </button>
          . Crossmark’s server can read bookmark data.
        </p>
      )}
    </form>
  );
}
