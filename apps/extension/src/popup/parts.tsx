import type { ReactNode } from 'react';
import type { Activity } from '../../../../packages/model';
import { cn } from '@/lib/utils';
import { activityLines, relative, type Tone } from './shared';

export function BrandMark() {
  return <img src="/icons/logo.svg" alt="" aria-hidden="true" className="size-7 shrink-0" />;
}

const tones: Record<Tone, string> = {
  accent: 'bg-primary',
  attention: 'bg-primary',
  muted: 'bg-muted-foreground',
  danger: 'bg-destructive',
};

export function StatusText({ label, tone, pulse }: { label: string; tone: Tone; pulse?: boolean }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-2 text-xs font-medium',
        tone === 'danger'
          ? 'text-destructive'
          : tone === 'attention'
            ? 'text-primary'
            : 'text-muted-foreground',
      )}
    >
      <span className={cn('size-1.5 rotate-45', tones[tone], pulse && 'animate-pulse')} />
      {label}
    </span>
  );
}

export function Stats({
  bookmarks,
  folders,
  children,
}: {
  bookmarks: number;
  folders: number;
  children?: ReactNode;
}) {
  return (
    <section className="chamfer border-l-2 border-primary bg-card px-4 py-3.5">
      <dl className="flex items-baseline gap-6">
        {[
          [bookmarks, bookmarks === 1 ? 'bookmark' : 'bookmarks'],
          [folders, folders === 1 ? 'folder' : 'folders'],
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
      {children && <p className="mt-1.5 text-xs text-muted-foreground">{children}</p>}
    </section>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

export function RowIcon({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-md border [&_svg]:size-4',
        active
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-secondary text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

export function ActivityRow({ event }: { event: Activity }) {
  const { icon: Icon, verb } = activityLines[event.kind];
  return (
    <li className="flex items-center gap-3 py-2.5">
      <RowIcon>
        <Icon />
      </RowIcon>
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium">{event.title || 'Untitled'}</span>{' '}
        <span className="text-muted-foreground">{verb}</span>
      </span>
      <time className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {relative(event.at)}
      </time>
    </li>
  );
}

export function ActivityList({ events }: { events: Activity[] }) {
  if (!events.length)
    return <p className="py-8 text-center text-sm text-muted-foreground">No changes yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {events.map((e) => (
        <ActivityRow key={e.id} event={e} />
      ))}
    </ul>
  );
}
