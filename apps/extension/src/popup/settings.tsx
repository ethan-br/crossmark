import { restoreConfirmation } from './shared';
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
              body: 'This browser stops syncing and is removed from your connected browsers. Its bookmarks stay here. Sync pending changes first; sign in with the same account to reconnect.',
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
          browser first. The account collection and your other browsers stay as they are.
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
            No pre-Crossmark snapshot is saved on this installation.
          </p>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        Bookmarks sync while your browsers are running. A 30-second check catches missed updates.
      </p>
      <p className="text-[11px] text-muted-foreground">v{packageJson.version}</p>
    </div>
  );
}
