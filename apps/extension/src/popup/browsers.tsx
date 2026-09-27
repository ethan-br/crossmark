import { Globe, Pause, Play, X } from 'lucide-react';
import type { Command } from '../engine';
import type { State } from '../state';
import { Button } from '@/components/ui/button';
import { RowIcon } from './parts';
import { relative, statusLabel } from './shared';

export interface Confirmation {
  title: string;
  body: string;
  command: Command;
  label: string;
}

export function Browsers({
  state,
  busy,
  act,
  confirm,
}: {
  state: State;
  busy: boolean;
  act: (message: Command) => unknown;
  confirm: (confirmation: Confirmation) => void;
}) {
  const browsers = state.snapshot?.devices.filter((d) => !d.revoked) ?? [];
  return (
    <ul className="divide-y divide-border">
      {browsers.map((d) => {
        const self = d.id === state.deviceId;
        const paused = self ? state.paused : d.paused;
        const lastSync = self ? state.lastSync : d.lastSeen;
        const selfStatus = self && state.status !== 'ready' ? statusLabel(state).label : undefined;
        return (
          <li
            key={d.id}
            className="flex items-center gap-3 py-3"
            aria-current={self ? 'true' : undefined}
          >
            <RowIcon active={self}>
              <Globe />
            </RowIcon>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{d.name}</p>
              <p className="text-xs text-muted-foreground">
                {paused
                  ? 'Paused'
                  : (selfStatus ?? (lastSync ? `Synced ${relative(lastSync)}` : 'Not synced yet'))}
              </p>
            </div>
            {!self && (
              <div className="flex shrink-0 gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${paused ? 'Resume' : 'Pause'} ${d.name}`}
                  title={paused ? 'Resume' : 'Pause'}
                  disabled={busy}
                  onClick={() => act({ type: 'pauseDevice', deviceId: d.id, paused: !paused })}
                >
                  {paused ? <Play /> : <Pause />}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="hover:text-destructive"
                  aria-label={`Disconnect ${d.name}`}
                  title="Disconnect"
                  disabled={busy}
                  onClick={() =>
                    confirm({
                      title: `Disconnect ${d.name}?`,
                      body: `${d.name} stops syncing and is removed from your connected browsers. Its bookmarks stay in that browser. To reconnect it, sign out and sign in again on that browser.`,
                      command: { type: 'revoke', deviceId: d.id },
                      label: 'Disconnect',
                    })
                  }
                >
                  <X />
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
