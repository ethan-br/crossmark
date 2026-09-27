import { Check, Pause, Play, RefreshCw } from 'lucide-react';
import { count, type Activity } from '../../../../packages/model';
import type { Command } from '../engine';
import type { State } from '../state';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ActivityList, SectionLabel, Stats } from './parts';
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
  const review = state.status === 'review' && !state.paused;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <Stats bookmarks={stats.bookmarks} folders={stats.folders}>
        {state.lastSync ? `Synced ${relative(state.lastSync)}` : 'Never synced'}
        {pending > 0 && <span className="text-primary"> · {pending} pending</span>}
      </Stats>
      {review && (
        <section className="rounded-md border border-primary/40 bg-primary/5 px-4 py-3">
          <p className="text-sm font-medium">Approve changes</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {pending} changes will update your other browsers. A recovery snapshot is saved first.
          </p>
        </section>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        {review ? (
          <Button disabled={busy} onClick={() => act({ type: 'approve' })}>
            <Check />
            Approve
          </Button>
        ) : state.needsSignIn ? (
          <Button onClick={onSignIn}>Sign in</Button>
        ) : (
          <Button disabled={busy || syncing || state.paused} onClick={() => act({ type: 'sync' })}>
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
      <section className="flex min-h-0 flex-1 flex-col gap-1">
        <SectionLabel>Recent</SectionLabel>
        <ScrollArea className="min-h-0 flex-1 -mr-3 pr-3">
          <ActivityList events={activity.slice(0, 20)} />
        </ScrollArea>
      </section>
    </div>
  );
}
