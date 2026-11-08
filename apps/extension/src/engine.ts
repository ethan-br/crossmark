import { debug } from './debug';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { type Node, type Snapshot, portableNodes, validateTree } from '../../../packages/model';
import { diff, parentFirst } from '../../../packages/sync-core';
import { Adapter } from './adapter';
import type { Credentials, SessionAuth } from './auth';
import { type State, type Store, initialState, publicState } from './state';
export type Command =
  | { type: 'state' }
  | { type: 'signIn'; credentials: Credentials }
  // Without credentials, connect registers with the session from a prior signIn.
  | { type: 'connect'; name: string; choice: 'remote' | 'local'; credentials?: Credentials }
  | { type: 'sync' }
  | { type: 'pause' }
  | { type: 'pauseDevice'; deviceId: string; paused: boolean }
  | { type: 'approve' }
  | { type: 'disconnect' }
  | { type: 'revoke'; deviceId: string }
  | { type: 'restore'; confirmed: boolean }
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
    if (!this.auth) throw new Error('Sign in to continue.');
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
  whenIdle(): Promise<void> {
    return this.serial.then(() => undefined);
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
          if (!fresh.connected && !fresh.registrationPending && !fresh.restorePending) {
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
          joinRecovery: state.joinRecovery ?? [],
          pending: state.outbox,
        };
      if (command.type === 'restore') {
        if (command.confirmed !== true) throw new Error('Confirm disconnect and restore first.');
        if (!state.restorePending) {
          if (state.joinRecovery === undefined)
            throw new Error('No pre-Crossmark snapshot is saved.');
          if (state.registrationPending) throw new Error('Finish connecting before restoring.');
          await this.adapter.recover(state, this.store);
          state.backup = await this.adapter.read(state);
          validateTree(state.joinRecovery);
          // Revoke first: failure leaves the browser connected and retryable without touching its tree.
          if (state.deviceId) {
            await this.authorize();
            try {
              await this.client.mutation(api.sync.revoke, {
                deviceId: state.deviceId as Id<'devices'>,
                targetDeviceId: state.deviceId as Id<'devices'>,
              });
            } catch (error) {
              if (!/This browser is disconnected/.test(String(error))) throw error;
            }
          }
          state.restorePending = { nodes: structuredClone(state.joinRecovery) };
          // Detach durably before any native write. Events cannot upload restoration.
          state.connected = false;
          state.outbox = [];
          state.joining = true;
          state.joinWiped = false;
          await this.save(state);
        }
        await this.restoreLocal();
        return publicState(await this.store.read());
      }
      if (state.restorePending) throw new Error('Finish restoring pre-Crossmark bookmarks first.');
      if (command.type === 'connect' && !['remote', 'local'].includes(command.choice))
        throw new Error('Choose whether to use synced bookmarks or this browser’s bookmarks.');
      if (command.type === 'signIn' || (command.type === 'connect' && command.credentials)) {
        if (!this.auth) throw new Error('Sign in to continue.');
        const account = await this.auth.signIn(command.credentials!);
        if (
          state.account &&
          state.account.id !== account.id &&
          (state.connected || state.registrationPending)
        ) {
          await this.auth.signOut();
          state.needsSignIn = true;
          await this.save(state);
          throw new Error(
            `Sign in as ${state.account.email}, or sign out of this installation before using a different account.`,
          );
        }
        if (state.installedAccountId && state.installedAccountId !== account.id) {
          // Native IDs from another account must not be adopted into this one.
          state.mappings = {};
          state.baseline = [];
          state.initialized = false;
          delete state.installedAccountId;
        }
        state.account = account;
        state.needsSignIn = false;
        await this.save(state);
        await this.authorize();
        if (state.connected) {
          await this.exchange();
          return publicState(await this.store.read());
        }
        if (command.type === 'signIn') {
          state.collectionExists = await this.client.query(api.sync.joinsExisting, {
            installationId: state.installationId,
          });
          if (!state.registrationPending) state.baseline = await this.adapter.read(state);
          await this.save(state);
          return publicState(state);
        }
      }
      if (command.type === 'connect') {
        if (!state.account) throw new Error('Sign in to continue.');
        if (state.connected) return publicState(state);
        await this.authorize();
        const account = state.account;
        const previouslyInstalled = state.initialized && state.installedAccountId === account.id;
        state.name = command.name.trim();
        if (!state.name || state.name.length > 80)
          throw new Error('Enter a browser name (up to 80 characters).');
        let local = state.registrationPending ? state.baseline : await this.adapter.read(state);
        if (
          state.registrationPending &&
          state.connectionChoice &&
          state.connectionChoice !== command.choice
        )
          throw new Error('Retry the original connection choice before choosing another.');
        // Preserve the first pre-Crossmark tree, including an empty tree.
        state.joinRecovery ??= structuredClone(local);
        if (!state.registrationPending && command.choice === 'local') {
          const ids = new Map(local.map((n) => [n.id, crypto.randomUUID()]));
          const mappings: Record<string, string> = {};
          for (const n of local) mappings[ids.get(n.id)!] = state.mappings[n.id];
          local = local.map((n) => ({
            ...n,
            id: ids.get(n.id)!,
            parentId: ids.get(n.parentId) ?? n.parentId,
            revision: 0,
          }));
          state.mappings = mappings;
        }
        state.connectionChoice = command.choice;
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
          choice: command.choice,
        });
        state.deviceId = result.deviceId;
        state.connected = true;
        state.registrationPending = false;
        delete state.connectionChoice;
        delete state.collectionExists;
        state.status = 'syncing';
        state.joining = result.joining;
        if (state.joining && !previouslyInstalled) state.joinRecovery ??= local;
        // A reconnect to the same collection already has native mappings.
        // Reconcile against them without repeating the first-time wipe.
        state.joinWiped = result.joining && previouslyInstalled ? true : undefined;
        state.initialized = !result.joining;
        if (!result.joining) state.installedAccountId = account.id;
        await this.save(state);
        state.snapshot = (await this.client.query(api.sync.snapshot, {
          deviceId: state.deviceId as Id<'devices'>,
        })) as Snapshot;
        await this.save(state);
        await this.exchange();
        return publicState(await this.store.read());
      }
      if (command.type === 'disconnect' && !state.connected) {
        if (state.registrationPending) {
          await this.authorize();
          await this.client.mutation(api.sync.cancelRegistration, {
            installationId: state.installationId,
          });
          // Never reuse a possibly committed registration after the user cancels.
          state.installationId = crypto.randomUUID();
          delete state.registrationPending;
          delete state.connectionChoice;
          state.baseline = await this.adapter.read(state);
          await this.save(state);
        }
        await this.auth?.signOut();
        delete state.account;
        delete state.collectionExists;
        state.needsSignIn = false;
        await this.save(state);
        return publicState(state);
      }
      if (!state.deviceId || !state.connected) throw new Error('Sign in to connect this browser.');
      const remotePause = command.type === 'pauseDevice' && command.deviceId !== state.deviceId;
      if (['revoke', 'approve'].includes(command.type) || remotePause) await this.authorize();
      if (command.type === 'revoke') {
        if (command.deviceId === state.deviceId)
          throw new Error('Use Sign out in Settings to remove this browser.');
        await this.client.mutation(api.sync.revoke, {
          deviceId: state.deviceId as Id<'devices'>,
          targetDeviceId: command.deviceId as Id<'devices'>,
        });
        await this.exchangeAndRefresh();
        return publicState(await this.store.read());
      }
      if (command.type === 'pauseDevice' && remotePause) {
        await this.client.mutation(api.sync.setPaused, {
          deviceId: state.deviceId as Id<'devices'>,
          targetDeviceId: command.deviceId as Id<'devices'>,
          paused: command.paused,
        });
        await this.exchangeAndRefresh();
        return publicState(await this.store.read());
      }
      if (command.type === 'disconnect') {
        if (!state.joining) await this.capture(state);
        if (state.outbox.length)
          throw new Error(
            'Sync your pending changes before signing out. You can also export them from Settings.',
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
            !/This browser is disconnected|Unauthenticated|Sign in to continue/.test(String(error))
          )
            throw error;
        }
        await this.auth?.signOut();
        // Keep native identity mappings and the pre-join recovery snapshot for
        // a later sign-in. The session, snapshot and pending work are cleared.
        const installedAccountId = state.initialized
          ? (state.installedAccountId ?? state.account?.id)
          : undefined;
        state = {
          ...initialState(),
          roots: state.roots,
          joinRecovery: state.joinRecovery,
          backup: state.backup,
          ...(installedAccountId
            ? {
                mappings: state.mappings,
                initialized: true,
                installedAccountId,
                rootSyncing: state.rootSyncing,
                rootSignature: state.rootSignature,
              }
            : {}),
        };
        await this.save(state);
        return publicState(state);
      }
      if (command.type === 'pause' || command.type === 'pauseDevice') {
        state.paused = command.type === 'pause' ? !state.paused : command.paused;
        state.pausePending = true;
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
      // A paused exchange only captures local edits and reports the pause to the server.
      if (!state.paused || ['sync', 'pause', 'pauseDevice'].includes(command.type)) {
        delete state.nextRetryAt;
        await this.save(state);
        await this.exchange();
      }
      return publicState(await this.store.read());
    });
  }
  sync() {
    return this.run(() => this.exchange());
  }
  // A paused exchange skips the snapshot. The peer change has already committed,
  // so a failed fetch only delays the browser list until the next exchange.
  private async exchangeAndRefresh() {
    await this.exchange();
    const state = await this.store.read();
    if (!state.paused) return;
    try {
      state.snapshot = (await this.client.query(api.sync.snapshot, {
        deviceId: state.deviceId as Id<'devices'>,
      })) as Snapshot;
      await this.save(state);
    } catch {
      debug.event('sync.exchange', 'failure');
    }
  }
  // Report an unacknowledged local pause change; otherwise adopt the server flag,
  // which another browser in the collection may have changed.
  private async reconcilePause(state: State) {
    const deviceId = state.deviceId as Id<'devices'>;
    if (state.pausePending) {
      await this.client.mutation(api.sync.setPaused, {
        deviceId,
        targetDeviceId: deviceId,
        paused: state.paused,
      });
      delete state.pausePending;
    } else state.paused = await this.client.query(api.sync.pauseState, { deviceId });
    await this.save(state);
  }
  // A paused browser stays paused while the server is unreachable.
  private async stayPaused(state: State) {
    if (!state.nextRetryAt || Date.now() >= state.nextRetryAt)
      try {
        await this.authorize();
        await this.reconcilePause(state);
      } catch (error) {
        debug.event('sync.pause', 'failure');
        if (/Unauthenticated|Sign in to continue|This browser is disconnected/i.test(String(error)))
          throw error;
      }
    return state.paused;
  }
  private async pausedExit(state: State) {
    debug.event('sync.exchange', 'paused');
    state.status = 'paused';
    await this.save(state);
  }
  private async restoreLocal() {
    let state = await this.store.read();
    if (!state.restorePending) return;
    try {
      await this.adapter.recover(state, this.store);
      state.baseline = await this.adapter.read(state);
      await this.save(state);
      await this.adapter.ensureRoots(state, this.store, state.restorePending.nodes);
      if (!(await this.project(state, state.restorePending.nodes)))
        throw new Error('Bookmarks changed during restoration. Retry to finish restoring.');
      await this.auth?.signOut();
      state = {
        ...initialState(),
        roots: state.roots,
        mappings: state.mappings,
        baseline: state.baseline,
        rootSyncing: state.rootSyncing,
        joinRecovery: state.joinRecovery,
        backup: state.backup,
      };
      await this.save(state);
    } catch (error) {
      state = await this.store.read();
      state.connected = false;
      state.status = 'error';
      state.error =
        error instanceof Error ? error.message : 'Could not restore bookmarks. Retry to finish.';
      await this.save(state);
      throw error;
    }
  }
  startup() {
    return this.run(async () => {
      const state = await this.store.read();
      if (!state.paused && state.nextRetryAt) {
        delete state.nextRetryAt;
        await this.save(state);
      }
      await this.exchange();
    });
  }
  private async capture(state: State) {
    const local = await this.adapter.read(state);
    const ops = diff(portableNodes(state.baseline), local, state.sequence);
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
    if (state.restorePending) return this.restoreLocal();
    if (!state.connected || !state.deviceId) {
      debug.event('sync.exchange', 'disconnected');
      return;
    }
    const started = performance.now();
    debug.event('sync.exchange', 'start');
    try {
      await this.adapter.recover(state, this.store);
      // The first device seeds the collection. Later devices keep their local
      // snapshot for export, but never upload it while replacing portable roots.
      if (state.joining && !state.installedAccountId)
        state.joinRecovery ??= state.backup ?? state.baseline;
      else if (!state.joining) await this.capture(state);
      if (state.paused && (await this.stayPaused(state))) return this.pausedExit(state);
      if (!state.joining && state.reviewCount && !state.safetyApproved) {
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
      await this.reconcilePause(state);
      if (state.paused) return this.pausedExit(state);
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
          if (state.joining) {
            // A native edit during installation is part of the local tree to
            // replace, including after a journaled partial projection.
            state.baseline = await this.adapter.read(state);
            await this.save(state);
          } else await this.capture(state);
          if ((state as State).status === 'review' && !state.safetyApproved) return;
          continue;
        }
        state.cursor = remote.revision;
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
        delete state.joinAliases;
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
        error instanceof TypeError ||
        /fetch|network|connection|offline|Could not reach/i.test(String(error))
          ? 'offline'
          : 'error';
      state.needsSignIn = /Unauthenticated|Sign in to continue|This browser is disconnected/i.test(
        String(error),
      );
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
      portableNodes(nodes)
        .filter((n) => this.adapter.projected(n))
        .map((n) => ({ ...n })),
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
      return diff(portableNodes(state.baseline), current, state.sequence).length === 0;
    };
    if (state.joining && !state.joinWiped) {
      // Remove only mapped user nodes. Native roots and browser-owned folders
      // are absent from the baseline and cannot enter this deletion list.
      for (const n of parentFirst(portableNodes(state.baseline)).reverse()) {
        if (!(await check())) return false;
        await this.adapter.write(state, this.store, {
          kind: 'delete',
          target: n,
          nativeId: state.mappings[n.id],
        });
      }
      state.joinWiped = true;
      await this.save(state);
    }
    // parentFirst emits siblings in target order, so indexed creates do not
    // need to move their unchanged siblings afterward.
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
      // Move across folders before fixing sibling positions. Removing a node
      // shifts its old siblings into place without native calls for them.
      if (existing.parentId !== n.parentId)
        await this.adapter.write(state, this.store, {
          kind: 'move',
          target: n,
          nativeId: state.mappings[n.id],
        });
    }
    // Delete children first. remove() refuses to delete folders containing new local children.
    for (const n of parentFirst(portableNodes(state.baseline)).reverse())
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
    if (state.joining) {
      state.joining = false;
      state.initialized = true;
      state.installedAccountId = state.account?.id;
      state.safetyApproved = false;
      delete state.joinWiped;
      delete state.joinLocal;
      delete state.joinAliases;
      delete state.reviewCount;
    }
    await this.save(state);
    return true;
  }
}
