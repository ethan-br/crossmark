import { useState } from 'react';
import { recoveryNodes, recoverySources, MAX_EXPORT_BYTES, type RecoverySource } from '../recovery';
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
  const [data, setData] = useState<unknown>();
  const [source, setSource] = useState<RecoverySource>('nodes');
  const [error, setError] = useState('');
  let count = 0;
  try {
    if (data) count = recoveryNodes(data, source).length;
  } catch {
    /* shown on review */
  }
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
        <SectionLabel>Recover bookmarks</SectionLabel>
        <p className="text-xs text-muted-foreground">
          Import a Crossmark JSON export, or use the saved pre-join tree. Recovery adds copies in an
          Other bookmarks folder and syncs them to every connected browser.
        </p>
        <input
          aria-label="Crossmark recovery export"
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            setData(undefined);
            setError('');
            if (!file) return;
            try {
              if (file.size > MAX_EXPORT_BYTES)
                throw new Error('Export is too large (maximum 8 MB).');
              const parsed: unknown = JSON.parse(await file.text());
              recoveryNodes(parsed, 'nodes');
              setData(parsed);
              setSource('nodes');
            } catch (e) {
              setError(String(e));
            }
          }}
        />
        <Button
          variant="outline"
          disabled={busy || !state.joinRecovery?.length}
          onClick={() => {
            setData({ version: 1, joinRecovery: state.joinRecovery });
            setSource('joinRecovery');
            setError('');
          }}
        >
          Use saved pre-join bookmarks
        </Button>
        {data !== undefined && (
          <>
            <select
              aria-label="Recovery source"
              value={source}
              onChange={(e) => setSource(e.target.value as RecoverySource)}
            >
              {recoverySources.map((key) => (
                <option key={key} value={key}>
                  {key === 'nodes'
                    ? 'Exported collection'
                    : key === 'localRecovery'
                      ? 'Safety snapshot'
                      : 'Pre-join bookmarks'}
                </option>
              ))}
            </select>
            <p className="text-xs">
              {count} live records selected. Deleted records and pending operations are excluded.
            </p>
            <Button
              disabled={busy || !count}
              onClick={() => {
                try {
                  const nodes = recoveryNodes(data, source);
                  confirm({
                    title: 'Recover bookmark copies?',
                    body: `Add ${nodes.length} records in a new Recovered bookmarks folder? Existing bookmarks stay in place. Copies sync to all connected browsers. Repeating recovery creates duplicates.`,
                    command: { type: 'recover', data, source, confirmed: true },
                    label: 'Recover copies',
                  });
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Review recovery
            </Button>
          </>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
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
