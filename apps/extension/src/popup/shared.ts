import browser from 'webextension-polyfill';
import { BookmarkPlus, FolderInput, RefreshCw, Trash2 } from 'lucide-react';
import type { Activity } from '../../../../packages/model';
import type { Command } from '../engine';
import type { State } from '../state';

export async function command<T = State>(message: Command): Promise<T> {
  const result = (await browser.runtime.sendMessage(message)) as
    { data: T; error?: string } | undefined;
  if (!result) throw new Error('The background is restarting. Try again.');
  if (result.error) throw new Error(result.error);
  return result.data;
}

export function relative(time?: number) {
  if (!time) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  return seconds < 60
    ? `${seconds}s ago`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ago`
        : `${Math.floor(seconds / 86400)}d ago`;
}

export const activityLines: Record<Activity['kind'], { icon: typeof RefreshCw; verb: string }> = {
  added: { icon: BookmarkPlus, verb: 'added' },
  removed: { icon: Trash2, verb: 'removed' },
  moved: { icon: FolderInput, verb: 'moved' },
  synced: { icon: RefreshCw, verb: 'synced' },
};

export type Status = State['status'];
export type Tone = 'accent' | 'muted' | 'danger';

export function statusLabel(state: State): { label: string; tone: Tone } {
  const status: Status = state.paused ? 'paused' : state.status;
  return {
    ready: { label: 'Up to date', tone: 'accent' as const },
    syncing: { label: 'Syncing', tone: 'accent' as const },
    paused: { label: 'Paused', tone: 'muted' as const },
    offline: { label: 'Offline', tone: 'muted' as const },
    error: {
      label: state.needsSignIn ? 'Sign-in required' : 'Sync failed',
      tone: 'danger' as const,
    },
    review: { label: 'Review needed', tone: 'accent' as const },
    setup: { label: 'Not signed in', tone: 'muted' as const },
  }[status];
}
