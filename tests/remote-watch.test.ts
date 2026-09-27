import { describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import { RemoteWatch } from '../apps/extension/src/remote-watch';
import { initialState, type State } from '../apps/extension/src/state';

type Signal = FunctionReturnType<typeof api.sync.signal>;

function setup() {
  let state: State = {
    ...initialState(),
    connected: true,
    deviceId: 'first',
    status: 'ready',
    snapshot: {
      nodes: [],
      revision: 1,
      devices: [
        { id: 'first', name: 'First', lastSeen: 0, cursor: 1, revoked: false, paused: false },
      ],
      activity: [],
    },
  };
  let emit: (signal: Signal) => void = () => {};
  const close = vi.fn(async () => {});
  const sync = vi.fn(async () => {});
  const client = {
    setAuth: vi.fn(),
    onUpdate: vi.fn((_query, _args, callback) => {
      emit = callback;
      return vi.fn();
    }),
    close,
  } as unknown as ConvexClient;
  const watch = new RemoteWatch(
    'https://example.convex.cloud',
    { token: async () => 'token', signIn: vi.fn(), signOut: vi.fn() },
    {
      read: async () => structuredClone(state),
      write: async (next) => {
        state = structuredClone(next);
      },
    },
    sync,
    () => client,
  );
  const signal = (patch: Partial<Signal> = {}): Signal => ({
    revision: 1,
    paused: false,
    revoked: false,
    devices: [{ id: 'first' as Signal['devices'][number]['id'], paused: false, revoked: false }],
    ...patch,
  });
  return {
    watch,
    sync,
    close,
    signal,
    push: (value: Signal) => emit(value),
    setState: (next: State) => {
      state = next;
    },
    state: () => state,
  };
}

describe('live remote change signals', () => {
  it('syncs a newer revision without reacting to its own unchanged signal', async () => {
    const { watch, sync, signal, push, state } = setup();
    watch.update(state());
    push(signal());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sync).not.toHaveBeenCalled();
    push(signal({ revision: 2 }));
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
  });

  it('notices remote pause and disconnects the socket after sign-out', async () => {
    const { watch, sync, close, signal, push, state, setState } = setup();
    watch.update(state());
    push(signal({ paused: true }));
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    setState({ ...state(), connected: false });
    watch.update(state());
    expect(close).toHaveBeenCalledTimes(1);
  });
});
