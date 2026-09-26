import type { Account } from './auth';
import type { Node, Operation, Snapshot } from '../../../packages/model';
export interface Journal {
  kind: 'create' | 'update' | 'move' | 'delete';
  target: Node;
  nativeId?: string;
  childrenBefore?: string[];
}
export interface State {
  version: 2;
  account?: Account;
  installationId: string;
  registrationPending?: boolean;
  needsSignIn?: boolean;
  deviceId?: string;
  name: string;
  browser: string;
  connected: boolean;
  paused: boolean;
  status: 'setup' | 'ready' | 'syncing' | 'offline' | 'error' | 'review' | 'paused';
  error?: string;
  baseline: Node[];
  mappings: Record<string, string>;
  roots: Record<string, string>;
  outbox: Operation[];
  sequence: number;
  cursor: number;
  lastSync?: number;
  snapshot?: Snapshot;
  journal?: Journal;
  joining: boolean;
  // Cleared after an older installation completes its pending join.
  joinLocal?: Node[];
  joinAliases?: Record<string, string>;
  initialized: boolean;
  safetyApproved: boolean;
  reviewCount?: number;
  failures: number;
  nextRetryAt?: number;
  backup?: Node[];
  rootSignature?: string;
}
export const initialState = (): State => ({
  version: 2,
  installationId: crypto.randomUUID(),
  name: 'This browser',
  browser:
    typeof navigator !== 'undefined' && /Firefox/.test(navigator.userAgent)
      ? 'Firefox'
      : 'Chromium',
  connected: false,
  paused: false,
  status: 'setup',
  baseline: [],
  mappings: {},
  roots: {},
  outbox: [],
  sequence: 0,
  cursor: 0,
  joining: false,
  initialized: false,
  safetyApproved: false,
  failures: 0,
});
export interface Store {
  read(): Promise<State>;
  write(state: State): Promise<void>;
}
export function publicState(state: State): State {
  return structuredClone(state);
}
