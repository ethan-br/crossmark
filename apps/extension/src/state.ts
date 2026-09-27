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
  /** Set by sign-in before registration: whether connecting replaces this browser's bookmarks. */
  collectionExists?: boolean;
  paused: boolean;
  /** A local pause change the server has not acknowledged yet. */
  pausePending?: boolean;
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
  joinWiped?: boolean;
  installedAccountId?: string;
  // Legacy merge state is cleared after replacement finishes.
  joinLocal?: Node[];
  joinAliases?: Record<string, string>;
  /** First local tree replaced by a cloud collection; survives disconnect. */
  joinRecovery?: Node[];
  initialized: boolean;
  safetyApproved: boolean;
  reviewCount?: number;
  failures: number;
  nextRetryAt?: number;
  backup?: Node[];
  rootSignature?: string; // Read once to migrate the previous root-ID signature.
  rootSyncing?: Record<string, boolean>;
}
function browserName() {
  if (typeof navigator === 'undefined') return 'Browser';
  if (/Firefox/.test(navigator.userAgent)) return 'Firefox';
  const brands =
    (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData
      ?.brands ?? [];
  const brand = brands.map((b) => b.brand).find((b) => !/Not.?A.?Brand|Chromium/i.test(b));
  return brand?.replace(/^(Google|Microsoft) /, '') ?? 'Chromium';
}
export const initialState = (): State => ({
  version: 2,
  installationId: crypto.randomUUID(),
  name: browserName(),
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
