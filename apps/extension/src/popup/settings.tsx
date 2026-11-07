import { restoreConfirmation } from './shared';
import { useState } from 'react';
import { Field } from './onboarding';
import { Download, LogOut } from 'lucide-react';
import type { State } from '../state';
import { Button } from '@/components/ui/button';
import packageJson from '../../../../package.json';
import type { Confirmation } from './browsers';
import { SectionLabel } from './parts';

export function Settings({
  state,
  busy,
  onExport,
  confirm,
}: {
  state: State;
  busy: boolean;
  onExport: () => void;
  confirm: (confirmation: Confirmation) => void;
}) {
  const [password, setPassword] = useState('');
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1.5">
        <SectionLabel>Account</SectionLabel>
        <p className="truncate text-sm">{state.account?.email}</p>
      </section>
      <section className="flex flex-col gap-2">
        <Button variant="outline" className="justify-start" onClick={onExport}>
          <Download />
          Export bookmarks
        </Button>
        <Button
          variant="outline"
          className="justify-start hover:border-destructive/50 hover:text-destructive"
          disabled={busy}
          onClick={() =>
            confirm({
              title: 'Sign out?',
              body: 'This browser stops syncing and is removed from your connected browsers. Its bookmarks stay here. Sync any changes waiting to be sent first. To reconnect, sign in and choose which bookmarks to keep.',
              command: { type: 'disconnect' },
              label: 'Sign out',
            })
          }
        >
          <LogOut />
          Sign out
        </Button>
      </section>
      <section className="flex flex-col gap-2">
        <SectionLabel>Pre-Crossmark bookmarks</SectionLabel>
        <p className="text-xs text-muted-foreground">
          Restore this browser’s original bookmarks from before Crossmark. This disconnects the
          browser first and keeps it disconnected until you reconnect. The account’s synced
          bookmarks and your other browsers stay as they are.
        </p>
        <Button
          variant="outline"
          disabled={busy || state.joinRecovery === undefined}
          onClick={() => confirm(restoreConfirmation)}
        >
          Disconnect and restore
        </Button>
        {state.joinRecovery === undefined && (
          <p className="text-xs text-muted-foreground">
            No original bookmarks are saved in this copy of Crossmark.
          </p>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <SectionLabel>Delete account</SectionLabel>
        <p className="text-xs text-muted-foreground">
          Permanently remove your cloud bookmarks, history, backups and all sessions. Native
          bookmarks stay in every browser. Export first if needed.
        </p>
        <Field
          id="delete-password"
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button
          variant="destructive"
          disabled={busy || !password}
          onClick={() => {
            confirm({
              title: 'Permanently delete your account?',
              body: 'This cannot be undone. All cloud data and access from every browser will be removed. Native bookmarks remain.',
              command: { type: 'deleteAccount', password },
              label: 'Delete account permanently',
            });
            setPassword('');
          }}
        >
          Delete account
        </Button>
      </section>
      <p className="text-xs text-muted-foreground">
        Bookmarks sync while your browsers are running. Crossmark also checks for updates every 30
        seconds.
      </p>
      <p className="text-[11px] text-muted-foreground">v{packageJson.version}</p>
    </div>
  );
}
