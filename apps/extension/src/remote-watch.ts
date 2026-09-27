import { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type { SessionAuth } from './auth';
import { debug } from './debug';
import type { State, Store } from './state';

type Signal = FunctionReturnType<typeof api.sync.signal>;

function changed(signal: Signal, state: State) {
  if (signal.paused !== state.paused && !state.pausePending) return true;
  if (signal.revision > (state.snapshot?.revision ?? -1)) return true;
  const known = state.snapshot?.devices ?? [];
  if (signal.devices.length !== known.length) return true;
  return signal.devices.some((device) => {
    const previous = known.find((item) => item.id === device.id);
    return !previous || previous.paused !== device.paused || previous.revoked !== device.revoked;
  });
}

export class RemoteWatch {
  private client?: ConvexClient;
  private unsubscribe?: () => void;
  private deviceId?: string;
  private syncing = false;
  private dirty = false;
  private latest?: Signal;
  private epoch = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDeviceId?: string;
  private failures = 0;

  constructor(
    private url: string,
    private auth: SessionAuth,
    private store: Store,
    private sync: () => Promise<unknown>,
    private whenIdle: () => Promise<unknown>,
    private createClient = (address: string) => new ConvexClient(address),
  ) {}

  update(state: State) {
    if (!state.connected || !state.deviceId || state.needsSignIn) {
      this.stop();
      return;
    }
    if (this.retryTimer) {
      if (this.retryDeviceId === state.deviceId) return;
      this.stop();
    }
    if (this.deviceId === state.deviceId) return;
    this.stop();
    this.deviceId = state.deviceId;
    const epoch = this.epoch;
    const client = this.createClient(this.url);
    this.client = client;
    client.setAuth(async () => {
      try {
        return await this.auth.token();
      } catch {
        this.fail(epoch);
        return null;
      }
    });
    this.unsubscribe = client.onUpdate(
      api.sync.signal,
      { deviceId: state.deviceId as Id<'devices'> },
      (signal) => {
        if (this.epoch !== epoch) return;
        this.failures = 0;
        this.queue(signal, epoch);
      },
      () => this.fail(epoch),
    );
  }

  private queue(signal: Signal, epoch: number) {
    if (this.epoch !== epoch) return;
    this.latest = signal;
    if (this.syncing) {
      this.dirty = true;
      return;
    }
    this.syncing = true;
    void this.check(signal, epoch);
  }

  private async check(signal: Signal, epoch: number) {
    try {
      // An ordinary bookmark exchange may have pushed this revision itself.
      // Wait for its snapshot write before deciding whether another pull is needed.
      await this.whenIdle();
      if (this.epoch !== epoch) return;
      const state = await this.store.read();
      if (this.epoch !== epoch || !state.connected || state.deviceId !== this.deviceId) return;
      if (!changed(signal, state)) return;
      await this.sync();
    } catch {
      this.fail(epoch);
    } finally {
      if (this.epoch === epoch) {
        this.syncing = false;
        if (this.dirty && this.latest) {
          this.dirty = false;
          this.queue(this.latest, epoch);
        }
      }
    }
  }

  private fail(epoch: number) {
    if (this.epoch !== epoch) return;
    debug.event('sync.watch', 'failure');
    const deviceId = this.deviceId;
    this.stop();
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(++this.failures, 5));
    debug.event('sync.watch', 'scheduled', { delayMs: delay });
    this.retryDeviceId = deviceId;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.retryDeviceId = undefined;
      void this.store
        .read()
        .then((state) => this.update(state))
        .catch(() => {
          debug.event('sync.watch', 'failure');
        });
    }, delay);
    // Surface revocation or an expired session through the normal engine state.
    void this.sync().catch(() => {});
  }

  stop() {
    this.epoch++;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.retryDeviceId = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    void this.client?.close().catch(() => {});
    this.client = undefined;
    this.deviceId = undefined;
    this.latest = undefined;
    this.dirty = false;
    this.syncing = false;
  }
}
