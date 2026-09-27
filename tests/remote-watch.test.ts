import { describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import { RemoteWatch } from '../apps/extension/src/remote-watch';
import { initialState, type State } from '../apps/extension/src/state';

type Signal = FunctionReturnType<typeof api.sync.signal>;

function setup(
  options: {
    sync?: () => Promise<void>;
    whenIdle?: () => Promise<void>;
    token?: () => Promise<string>;
  } = {},
) {
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
  let emitError: (error: Error) => void = () => {};
  const close = vi.fn(async () => {});
  const setAuth = vi.fn();
  const sync = vi.fn(options.sync ?? (async () => {}));
  const subscribe = vi.fn((_query, _args, callback, onError) => {
    emit = callback;
    emitError = onError;
    return vi.fn();
  });
  const client = {
    setAuth,
    onUpdate: subscribe,
    close,
  } as unknown as ConvexClient;
  const watch = new RemoteWatch(
    'https://example.convex.cloud',
    { token: options.token ?? (async () => 'token'), signIn: vi.fn(), signOut: vi.fn() },
    {
      read: async () => structuredClone(state),
      write: async (next) => {
        state = structuredClone(next);
      },
    },
    sync,
    options.whenIdle ?? (async () => {}),
    () => client,
  );
  const signal = (patch: Partial<Signal> = {}): Signal => ({
    revision: 1,
    paused: false,
    devices: [{ id: 'first' as Signal['devices'][number]['id'], paused: false, revoked: false }],
    ...patch,
  });
  return {
    watch,
    sync,
    close,
    setAuth,
    subscribe,
    signal,
    push: (value: Signal) => emit(value),
    error: (value: Error) => emitError(value),
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

  it('waits for an ordinary exchange before deciding whether its own push needs a pull', async () => {
    let release!: () => void;
    const idle = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { watch, sync, signal, push, state, setState } = setup({ whenIdle: () => idle });
    watch.update(state());
    push(signal({ revision: 2 }));
    expect(sync).not.toHaveBeenCalled();
    setState({ ...state(), snapshot: { ...state().snapshot!, revision: 2 } });
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sync).not.toHaveBeenCalled();
  });

  it('refreshes the browser roster when a peer changes pause state', async () => {
    const { watch, sync, signal, push, state, setState } = setup();
    const peer = {
      id: 'second',
      name: 'Second',
      lastSeen: 0,
      cursor: 1,
      revoked: false,
      paused: false,
    };
    setState({
      ...state(),
      snapshot: { ...state().snapshot!, devices: [...state().snapshot!.devices, peer] },
    });
    watch.update(state());
    push(
      signal({
        devices: [
          signal().devices[0],
          { id: peer.id as Signal['devices'][number]['id'], paused: true, revoked: false },
        ],
      }),
    );
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
  });

  it('coalesces signals received during a watch-triggered exchange', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const { watch, sync, signal, push, state, setState } = setup({
      sync: async () => {
        if (++calls === 1) await pending;
      },
    });
    watch.update(state());
    push(signal({ revision: 2 }));
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    push(signal({ revision: 3 }));
    expect(sync).toHaveBeenCalledTimes(1);
    setState({ ...state(), snapshot: { ...state().snapshot!, revision: 2 } });
    release();
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(2));
  });

  it('coalesces back-to-back signals before the first idle check resolves', async () => {
    let releaseIdle!: () => void;
    let releaseSync!: () => void;
    const idle = new Promise<void>((resolve) => {
      releaseIdle = resolve;
    });
    const pendingSync = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    const whenIdle = vi.fn(() => idle);
    const { watch, sync, signal, push, state, setState } = setup({
      whenIdle,
      sync: () => pendingSync,
    });
    watch.update(state());
    push(signal({ revision: 2 }));
    push(signal({ revision: 3 }));
    expect(whenIdle).toHaveBeenCalledTimes(1);
    releaseIdle();
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    setState({ ...state(), snapshot: { ...state().snapshot!, revision: 3 } });
    releaseSync();
    await vi.waitFor(() => expect(whenIdle).toHaveBeenCalledTimes(2));
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('handles query errors and rebuilds the subscription after a delay', async () => {
    vi.useFakeTimers();
    try {
      const { watch, sync, close, subscribe, error, state } = setup();
      watch.update(state());
      error(new Error('private backend detail'));
      expect(close).toHaveBeenCalledTimes(1);
      expect(sync).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(subscribe).toHaveBeenCalledTimes(2);
      watch.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds the client after an auth token fetch fails', async () => {
    vi.useFakeTimers();
    try {
      const { watch, sync, close, setAuth, subscribe, state } = setup({
        token: async () => {
          throw new Error('temporary auth failure');
        },
      });
      watch.update(state());
      const fetchToken = setAuth.mock.calls[0][0] as () => Promise<string | null>;
      await expect(fetchToken()).resolves.toBeNull();
      expect(close).toHaveBeenCalledTimes(1);
      expect(sync).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(subscribe).toHaveBeenCalledTimes(2);
      watch.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
