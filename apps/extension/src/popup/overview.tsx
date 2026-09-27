import { Check, Pause, Play, RefreshCw } from 'lucide-react';
import { count, type Activity } from '../../../../packages/model';
import type { Command } from '../engine';
import type { State } from '../state';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ActivityList, SectionLabel } from './parts';
import { relative } from './shared';

export function Overview({
  state,
  activity,
  busy,
  act,
  onSignIn,
}: {
  state: State;
  activity: Activity[];
  busy: boolean;
  act: (message: Command) => unknown;
  onSignIn: () => void;
}) {
  const stats = count(state.baseline);
  const pending = state.outbox.length;
  const syncing = state.status === 'syncing' && !state.paused;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <section className="chamfer border-l-2 border-primary bg-card px-4 py-3.5">
        <dl className="flex items-baseline gap-6">
          {[
            [stats.bookmarks, stats.bookmarks === 1 ? 'bookmark' : 'bookmarks'],
            [stats.folders, stats.folders === 1 ? 'folder' : 'folders'],
          ].map(([value, label]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <dt className="sr-only">{label}</dt>
              <dd className="text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
              <span aria-hidden className="text-xs text-muted-foreground">
                {label}
              </span>
            </div>
          ))}
        </dl>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Synced {relative(state.lastSync)}
          {pending > 0 && <span className="text-primary"> · {pending} pending</span>}
        </p>
      </section>
      {state.status === 'review' ? (
        <section className="flex flex-col gap-3 rounded-md border border-primary/40 bg-primary/5 p-4">
          <div>
            <p className="text-sm font-medium">Approve changes</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {pending} changes will update your other browsers.
            </p>
          </div>
          <Button disabled={busy} onClick={() => act({ type: 'approve' })}>
            <Check />
            Approve
          </Button>
        </section>
      ) : (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          {state.needsSignIn ? (
            <Button onClick={onSignIn}>Sign in</Button>
          ) : (
            <Button
              disabled={busy || syncing || state.paused}
              onClick={() => act({ type: 'sync' })}
            >
              <RefreshCw className={syncing ? 'animate-spin' : undefined} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
          <Button
            variant="outline"
            aria-pressed={state.paused}
            disabled={busy}
            onClick={() => act({ type: 'pause' })}
          >
            {state.paused ? <Play /> : <Pause />}
            {state.paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      )}
      <section className="flex min-h-0 flex-1 flex-col gap-1">
        <SectionLabel>Recent</SectionLabel>
        <ScrollArea className="min-h-0 flex-1 -mr-3 pr-3">
          <ActivityList events={activity.slice(0, 20)} />
        </ScrollArea>
      </section>
    </div>
  );
}
