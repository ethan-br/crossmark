import { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type { SessionAuth } from './auth';
import type { State, Store } from './state';

type Signal = FunctionReturnType<typeof api.sync.signal>;

function changed(signal: Signal, state: State) {
  if (signal.revoked || (signal.paused !== state.paused && !state.pausePending)) return true;
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

  constructor(
    private url: string,
    private auth: SessionAuth,
    private store: Store,
    private sync: () => Promise<unknown>,
    private createClient = (address: string) => new ConvexClient(address),
  ) {}

  update(state: State) {
    if (!state.connected || !state.deviceId || state.needsSignIn) {
      this.stop();
      return;
    }
    if (this.deviceId === state.deviceId) return;
    this.stop();
    this.deviceId = state.deviceId;
    const epoch = this.epoch;
    const client = this.createClient(this.url);
    this.client = client;
    client.setAuth(() => this.auth.token().catch(() => null));
    this.unsubscribe = client.onUpdate(
      api.sync.signal,
      { deviceId: state.deviceId as Id<'devices'> },
      (signal) => {
        this.latest = signal;
        if (this.syncing) this.dirty = true;
        else void this.check(signal, epoch);
      },
    );
  }

  private async check(signal: Signal, epoch: number) {
    if (this.epoch !== epoch) return;
    const state = await this.store.read();
    if (this.epoch !== epoch || !state.connected || state.deviceId !== this.deviceId) return;
    if (!changed(signal, state)) return;
    if (this.syncing) {
      this.dirty = true;
      return;
    }
    this.syncing = true;
    try {
      await this.sync();
    } catch {
      // The durable alarm and the next subscription update can retry.
    } finally {
      if (this.epoch !== epoch) return;
      this.syncing = false;
      if (this.dirty && this.latest) {
        this.dirty = false;
        void this.check(this.latest, epoch);
      }
    }
  }

  stop() {
    this.epoch++;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    void this.client?.close();
    this.client = undefined;
    this.deviceId = undefined;
    this.latest = undefined;
    this.dirty = false;
    this.syncing = false;
  }
}
