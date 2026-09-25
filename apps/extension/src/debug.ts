/** Diagnostics accept only fixed vocabulary and numeric metadata, never application payloads. */
const operations = [
  'auth.signIn',
  'auth.signOut',
  'auth.token',
  'bookmarks.read',
  'bookmarks.write',
  'bookmarks.recover',
  'command.connect',
  'command.disconnect',
  'command.revoke',
  'command.restore',
  'command.sync',
  'command.pause',
  'command.pauseDevice',
  'command.approve',
  'command.export',
  'sync.exchange',
  'sync.pause',
  'sync.capture',
  'sync.project',
  'sync.retry',
] as const;
type Operation = (typeof operations)[number];
const outcomes = [
  'start',
  'success',
  'failure',
  'disconnected',
  'paused',
  'review',
  'backoff',
  'local-change',
  'scheduled',
] as const;
type Outcome = (typeof outcomes)[number];
interface Context {
  requestId?: number;
  elapsedMs?: number;
  count?: number;
  attempt?: number;
  delayMs?: number;
}
export interface DebugEntry extends Context {
  timestamp: string;
  browser: 'Firefox' | 'Chromium';
  runtime: 'background';
  operation: Operation;
  outcome: Outcome;
}
export class DebugLog {
  private enabled = false;
  private entries: DebugEntry[] = [];
  private sequence = 0;
  private generation = 0;
  constructor(
    private browser: DebugEntry['browser'],
    private output: (prefix: string, entry: DebugEntry) => void = (prefix, entry) =>
      console.debug(prefix, entry),
  ) {}
  setEnabled(value: unknown) {
    const enabled = value === true;
    if (enabled !== this.enabled) this.generation++;
    this.enabled = enabled;
  }
  clear() {
    this.entries = [];
    this.generation++;
  }
  export() {
    return JSON.stringify({ version: 1, enabled: this.enabled, entries: this.entries }, null, 2);
  }
  event(operation: Operation, outcome: Outcome, context: Context = {}) {
    if (!this.enabled) return;
    // Validate at runtime too: callers cannot smuggle strings or nested payloads through a cast.
    if (!operations.includes(operation) || !outcomes.includes(outcome)) return;
    const entry: DebugEntry = {
      timestamp: new Date().toISOString(),
      browser: this.browser,
      runtime: 'background',
      operation,
      outcome,
    };
    for (const key of ['requestId', 'elapsedMs', 'count', 'attempt', 'delayMs'] as const) {
      const value = context[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) entry[key] = value;
    }
    this.entries.push(entry);
    if (this.entries.length > 500) this.entries.shift();
    // Console instrumentation must never affect bookmark or authentication operations.
    try {
      this.output('[Crossmark debug]', { ...entry });
    } catch {
      /* best effort */
    }
  }
  async trace<T>(operation: Operation, work: () => Promise<T>): Promise<T> {
    if (!this.enabled) return work();
    const requestId = ++this.sequence;
    const generation = this.generation;
    const start = performance.now();
    this.event(operation, 'start', { requestId });
    try {
      const result = await work();
      if (generation === this.generation)
        this.event(operation, 'success', { requestId, elapsedMs: performance.now() - start });
      return result;
    } catch (error) {
      if (generation === this.generation)
        this.event(operation, 'failure', { requestId, elapsedMs: performance.now() - start });
      throw error;
    }
  }
}
export const debug = new DebugLog(
  typeof navigator !== 'undefined' && /Firefox/.test(navigator.userAgent) ? 'Firefox' : 'Chromium',
);
