import { debug } from './debug';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { type Node, type Snapshot, validateTree } from '../../../packages/model';
import { diff, parentFirst } from '../../../packages/sync-core';
import { Adapter } from './adapter';
import type { SessionAuth } from './auth';
import { type State, type Store, initialState, publicState } from './state';
export type Command =
  | { type: 'state' }
  | { type: 'connect'; name: string }
  | { type: 'sync' }
  | { type: 'pause' }
  | { type: 'approve' }
  | { type: 'disconnect' }
  | { type: 'revoke'; deviceId: string }
  | { type: 'restore'; activityId: string }
  | { type: 'export' };
export class Engine {
  private serial: Promise<unknown> = Promise.resolve();
  private client: Pick<ConvexHttpClient, 'query' | 'mutation'>;
  private httpClient?: ConvexHttpClient;
  constructor(
    readonly store: Store,
    readonly adapter: Adapter,
    url: string,
    private onState?: (state: State) => void,
    transport?: Pick<ConvexHttpClient, 'query' | 'mutation'>,
    private auth?: SessionAuth,
  ) {
    this.httpClient = transport ? undefined : new ConvexHttpClient(url);
    this.client = transport ?? this.httpClient!;
  }
  private async authorize() {
    if (!this.auth) throw new Error('Sign in with Google to continue.');
    const token = await this.auth.token();
    this.httpClient?.setAuth(token);
  }
  private async save(state: State) {
    await this.store.write(state);
    this.onState?.(publicState(state));
  }
  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(work, work);
    this.serial = next.catch(() => {});
    return next;
  }
  command(command: Command): Promise<unknown> {
    if (command.type === 'state') return this.commandImpl(command);
    return debug.trace(`command.${command.type}`, () => this.commandImpl(command));
  }
  private commandImpl(command: Command): Promise<unknown> {
    // Read-only status must remain live while a serialized exchange is running.
    if (command.type === 'state')
      return this.store.read().then((state) => {
        if (state.connected || state.registrationPending) return publicState(state);
        return this.run(async () => {
          const fresh = await this.store.read();
          if (!fresh.connected && !fresh.registrationPending) {
            fresh.baseline = await this.adapter.read(fresh);
            await this.save(fresh);
          }
          return publicState(fresh);
        });
      });
    return this.run(async () => {
      let state = await this.store.read();
      if (command.type === 'export')
        return {
          version: 1,
          exportedAt: new Date().toISOString(),
          nodes: state.snapshot?.nodes ?? state.baseline,
          localRecovery: state.backup ?? [],
          pending: state.outbox,
        };
      if (command.type === 'connect') {
        if (!this.auth) throw new Error('Sign in with Google to continue.');
        const account = await this.auth.signIn();
        if (state.account && state.account.id !== account.id) {
          await this.auth.signOut();
          state.needsSignIn = true;
          await this.save(state);
          throw new Error(
            `Sign in as ${state.account.email}, or sign out of this installation before using a different account.`,
          );
        }
        state.account = account;
        state.needsSignIn = false;
        await this.save(state);
        await this.authorize();
        if (state.connected) {
          await this.exchange();
          return publicState(await this.store.read());
        }
        state.name = command.name.trim();
        if (!state.name || state.name.length > 80)
          throw new Error('Enter a browser name (up to 80 characters).');
        const local = state.registrationPending ? state.baseline : await this.adapter.read(state);
        validateTree(local);
        state.backup = local;
        state.baseline = local;
        state.registrationPending = true;
        await this.save(state);
        const result = await this.client.mutation(api.sync.connect, {
          installationId: state.installationId,
          name: state.name,
          browser: state.browser,
          nodes: local,
        });
        state.deviceId = result.deviceId;
        state.connected = true;
        state.registrationPending = false;
        state.status = 'syncing';
        state.joining = result.joining;
        state.initialized = !result.joining;
        await this.save(state);
        state.snapshot = (await this.client.query(api.sync.snapshot, {
          deviceId: state.deviceId as Id<'devices'>,
        })) as Snapshot;
        await this.save(state);
        await this.exchange();
        return publicState(await this.store.read());
      }
      if (!state.deviceId || !state.connected)
        throw new Error('Sign in with Google to connect this browser.');
      if (['revoke', 'approve', 'restore'].includes(command.type)) await this.authorize();
      if (command.type === 'revoke') {
        await this.client.mutation(api.sync.revoke, {
          deviceId: state.deviceId as Id<'devices'>,
          targetDeviceId: command.deviceId as Id<'devices'>,
        });
        await this.exchange();
        return publicState(await this.store.read());
      }
      if (command.type === 'disconnect') {
        if (!state.joining) await this.capture(state);
        if (state.outbox.length)
          throw new Error(
            'Sync your pending changes before disconnecting. You can also export them from Settings.',
          );
        try {
          await this.authorize();
          await this.client.mutation(api.sync.revoke, {
            deviceId: state.deviceId as Id<'devices'>,
            targetDeviceId: state.deviceId as Id<'devices'>,
          });
        } catch (error) {
          // A remotely revoked installation can still clear its local connection.
          if (
            !/This browser is disconnected|Unauthenticated|Sign in with Google/.test(String(error))
          )
            throw error;
        }
        await this.auth?.signOut();
        // Synthetic menu/mobile folders remain native roots after sign-out.
        // Retain only root IDs so reconnecting cannot import those wrappers.
        state = { ...initialState(), roots: state.roots };
        await this.save(state);
        return publicState(state);
      }
      if (command.type === 'pause') {
        state.paused = !state.paused;
        state.status = state.paused ? 'paused' : 'ready';
        await this.save(state);
      }
      if (command.type === 'approve') {
        await this.client.mutation(api.sync.backup, {
          deviceId: state.deviceId as Id<'devices'>,
          nodes: state.backup ?? state.baseline,
          reason: 'Before large local change',
        });
        state.safetyApproved = true;
        state.status = 'ready';
        await this.save(state);
      }
      if (command.type === 'restore') {
        const event = state.snapshot?.activity.find((a) => a.id === command.activityId);
        if (!event?.before) throw new Error('This change has no earlier version to restore.');
        // Recover a folder and its tombstoned descendants as explicit operations.
        const source = state.snapshot!.nodes;
        const restore = [event.attempted ?? event.before];
        if (event.before.kind === 'folder') {
          const ids = new Set([event.nodeId]);
          let added = true;
          while (added) {
            added = false;
            for (const n of source)
              if (n.deleted && ids.has(n.parentId) && !ids.has(n.id)) {
                ids.add(n.id);
                restore.push(n);
                added = true;
              }
          }
        }
        for (const n of parentFirst(restore.map((n) => ({ ...n, deleted: false })))) {
          state.outbox.push({
            id: crypto.randomUUID(),
            sequence: ++state.sequence,
            nodeId: n.id,
            baseRevision: source.find((x) => x.id === n.id)?.revision ?? 0,
            kind: 'restore',
            node: { ...n, deleted: false },
          });
        }
        await this.save(state);
      }
      if (!state.paused || command.type === 'sync') {
        delete state.nextRetryAt;
        await this.save(state);
        if (command.type === 'sync' && state.paused) {
          state.paused = false;
          await this.save(state);
        }
        await this.exchange();
      }
      return publicState(await this.store.read());
    });
  }
  sync() {
    return this.run(() => this.exchange());
  }
  private async capture(state: State) {
    const local = await this.adapter.read(state);
    const ops = diff(state.baseline, local, state.sequence);
    debug.event('sync.capture', 'success', { count: ops.length });
    if (ops.length) {
      if (ops.length > 50 || ops.filter((o) => o.kind === 'delete').length > 20) {
        state.backup = state.baseline;
        state.reviewCount = ops.length;
        if (!state.safetyApproved) state.status = 'review';
      }
      state.outbox.push(...ops);
      state.sequence += ops.length;
    }
    state.baseline = local;
    await this.save(state);
    return ops.length;
  }
  private async exchange() {
    let state = await this.store.read();
    if (!state.connected || !state.deviceId) {
      debug.event('sync.exchange', 'disconnected');
      return;
    }
    const started = performance.now();
    debug.event('sync.exchange', 'start');
    try {
      await this.adapter.recover(state, this.store);
      // A joining browser installs the collection. Its preexisting bookmarks
      // are only a local recovery snapshot, never an upload to the collection.
      if (state.joining) {
        delete state.reviewCount; // Clear review state from an interrupted older join.
        state.safetyApproved = false;
      } else await this.capture(state);
      if (state.paused) {
        debug.event('sync.exchange', 'paused');
        state.status = 'paused';
        await this.save(state);
        return;
      }
      if (state.reviewCount && !state.safetyApproved) {
        debug.event('sync.exchange', 'review');
        state.status = 'review';
        await this.save(state);
        return;
      }
      if (state.nextRetryAt && Date.now() < state.nextRetryAt) {
        debug.event('sync.retry', 'backoff', { delayMs: state.nextRetryAt - Date.now() });
        return;
      }
      await this.authorize();
      state.status = 'syncing';
      delete state.error;
      state.needsSignIn = false;
      await this.save(state);
      let passes = 0;
      do {
        while (state.outbox.length) {
          const batch = state.outbox.slice(0, 100);
          const result = await this.client.mutation(api.sync.push, {
            deviceId: state.deviceId as Id<'devices'>,
            operations: batch,
          });
          state.outbox = state.outbox.filter((o) => !result.acknowledged.includes(o.id));
          await this.save(state);
        }
        const remote = (await this.client.query(api.sync.snapshot, {
          deviceId: state.deviceId as Id<'devices'>,
        })) as Snapshot;
        state.snapshot = remote;
        await this.save(state);
        await this.adapter.ensureRoots(state, this.store, remote.nodes);
        const settled = await this.project(state, remote.nodes);
        debug.event('sync.project', settled ? 'success' : 'local-change', { attempt: passes + 1 });
        if (!settled) {
          if (!state.joining) await this.capture(state);
          if ((state as State).status === 'review' && !state.safetyApproved) return;
          continue;
        }
        state.cursor = remote.revision;
        state.joining = false;
        state.initialized = true;
        delete state.joinLocal;
        delete state.joinAliases;
        await this.client.mutation(api.sync.checkpoint, {
          deviceId: state.deviceId as Id<'devices'>,
          cursor: state.cursor,
        });
        debug.event('sync.exchange', 'success', { elapsedMs: performance.now() - started });
        state.lastSync = Date.now();
        delete state.nextRetryAt;
        state.status = 'ready';
        state.failures = 0;
        state.safetyApproved = false;
        delete state.reviewCount;
        delete state.error;
        state.needsSignIn = false;
        await this.save(state);
        return;
      } while (++passes < 4);
      state.status = 'syncing';
      await this.save(state);
    } catch (error) {
      // A journal may have been committed after our last local copy. Keep it for recovery.
      state = await this.store.read();
      state.failures++;
      state.nextRetryAt =
        Date.now() +
        Math.min(300_000, 1000 * 2 ** Math.min(state.failures, 8)) * (0.8 + Math.random() * 0.4);
      debug.event('sync.exchange', 'failure', { elapsedMs: performance.now() - started });
      debug.event('sync.retry', 'scheduled', {
        attempt: state.failures,
        delayMs: Math.max(0, state.nextRetryAt - Date.now()),
      });
      state.status =
        error instanceof TypeError || /fetch|network|connection|offline/i.test(String(error))
          ? 'offline'
          : 'error';
      state.needsSignIn = /Unauthenticated|Sign in with Google/i.test(String(error));
      state.error =
        error instanceof Error
          ? error.message
              .replace(/\[Request ID:[^\]]*\]\s*/g, '')
              .replace(/Uncaught (?:ConvexError|Error): /, '')
              .split('\n')[0]
          : 'Could not synchronize. Try again.';
      await this.save(state);
    }
  }
  private async project(state: State, nodes: Node[]): Promise<boolean> {
    const visible = parentFirst(
      nodes.filter((n) => this.adapter.projected(n)).map((n) => ({ ...n })),
    );
    // Canonical separators omitted on Chromium do not occupy native indices.
    const groups = new Map<string, Node[]>();
    for (const n of visible) {
      const group = groups.get(n.parentId) ?? [];
      group.push(n);
      groups.set(n.parentId, group);
    }
    for (const group of groups.values())
      group
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        .forEach((n, i) => (n.order = i));
    const target = new Map(visible.map((n) => [n.id, n]));
    const check = async () => {
      const current = await this.adapter.read(state);
      if (diff(state.baseline, current, state.sequence).length === 0) return true;
      if (state.joining) {
        // A concurrent native edit during installation stays local and is
        // included in the next journaled pass, never sent as a cloud change.
        state.baseline = current;
        await this.save(state);
      }
      return false;
    };
    for (const n of visible) {
      if (!(await check())) return false;
      const existing = state.baseline.find((x) => x.id === n.id);
      if (!existing) await this.adapter.write(state, this.store, { kind: 'create', target: n });
      else if (existing.title !== n.title || existing.url !== n.url)
        await this.adapter.write(state, this.store, {
          kind: 'update',
          target: {
            ...existing,
            title: n.title,
            ...(n.url ? { url: n.url } : {}),
            revision: n.revision,
          },
          nativeId: state.mappings[n.id],
        });
    }
    for (const n of visible) {
      if (!(await check())) return false;
      const existing = state.baseline.find((x) => x.id === n.id)!;
      if (existing.parentId !== n.parentId || existing.order !== n.order)
        await this.adapter.write(state, this.store, {
          kind: 'move',
          target: n,
          nativeId: state.mappings[n.id],
        });
    }
    // Delete children first. remove() refuses to delete folders containing new local children.
    for (const n of parentFirst(state.baseline).reverse())
      if (!target.has(n.id)) {
        if (!(await check())) return false;
        await this.adapter.write(state, this.store, {
          kind: 'delete',
          target: n,
          nativeId: state.mappings[n.id],
        });
      }
    for (const n of visible) {
      if (!(await check())) return false;
      const existing = state.baseline.find((x) => x.id === n.id)!;
      if (existing.parentId !== n.parentId || existing.order !== n.order)
        await this.adapter.write(state, this.store, {
          kind: 'move',
          target: n,
          nativeId: state.mappings[n.id],
        });
    }
    if (!(await check())) return false;
    state.baseline = visible;
    await this.save(state);
    return true;
  }
}
