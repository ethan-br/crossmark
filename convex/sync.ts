import { v, ConvexError } from 'convex/values';
import { mutation, query, type QueryCtx, type MutationCtx } from './_generated/server';
import { node, operation } from './schema';
import { authComponent } from './auth';
import type { Id } from './_generated/dataModel';
import { validateTree, type Activity, type Node, type Operation } from '../packages/model';
import { activityKind, applyOperation } from '../packages/sync-core';
async function compactDeleted(ctx: MutationCtx, collectionId: Id<'collections'>, nodes: Node[]) {
  for (const n of nodes.filter((n) => n.deleted)) {
    const existing = await ctx.db
      .query('retiredNodes')
      .withIndex('by_node', (q) => q.eq('collectionId', collectionId).eq('nodeId', n.id))
      .unique();
    if (!existing) await ctx.db.insert('retiredNodes', { collectionId, nodeId: n.id });
  }
  return nodes.filter((n) => !n.deleted);
}
const fail = (message: string): never => {
  throw new ConvexError(message);
};
async function authenticate(ctx: QueryCtx | MutationCtx, deviceId: Id<'devices'>) {
  const user = await authComponent.getAuthUser(ctx);
  const device = await ctx.db.get(deviceId);
  if (!device || device.revoked || device.ownerId !== user._id)
    return fail('This browser is disconnected. Sign in to reconnect.');
  return device;
}
function label(value: string) {
  if (!value.trim() || value.length > 80) fail('Use a browser name between 1 and 80 characters.');
  return value.trim();
}
function installation(ctx: QueryCtx, ownerId: string, installationId: string) {
  return ctx.db
    .query('devices')
    .withIndex('by_installation', (q) =>
      q.eq('ownerId', ownerId).eq('installationId', installationId),
    )
    .unique();
}
function ownedCollection(ctx: QueryCtx, ownerId: string) {
  return ctx.db
    .query('collections')
    .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
    .unique();
}
// Report an existing collection so the popup requires a local-versus-account choice.
export const joinsExisting = query({
  args: { installationId: v.string() },
  handler: async (ctx, { installationId }) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!/^[a-f0-9-]{36}$/.test(installationId)) fail('Invalid installation ID.');
    const existing = await installation(ctx, user._id, installationId);
    if (existing?.revoked)
      fail('This browser was disconnected. Sign out of Crossmark here, then sign in again.');
    if (existing) return true;
    return !!(await ownedCollection(ctx, user._id));
  },
});
export const connect = mutation({
  args: {
    installationId: v.string(),
    name: v.string(),
    browser: v.string(),
    nodes: v.array(node),
    // Older clients only supported replacing local with remote.
    choice: v.optional(v.union(v.literal('remote'), v.literal('local'))),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!/^[a-f0-9-]{36}$/.test(args.installationId)) fail('Invalid installation ID.');
    const existing = await installation(ctx, user._id, args.installationId);
    if (existing) {
      if (existing.revoked)
        fail('This browser was disconnected. Sign out of Crossmark here, then sign in again.');
      const collection = await ctx.db.get(existing.collectionId);
      return { deviceId: existing._id, joining: collection?.sourceDevice !== args.installationId };
    }
    let collection = await ownedCollection(ctx, user._id);
    const joining = !!collection;
    if (!collection) {
      validateTree(args.nodes);
      const collectionId = await ctx.db.insert('collections', {
        ownerId: user._id,
        nodes: args.nodes
          .filter((n) => !n.deleted)
          .map((n) => ({ ...n, revision: 1, deleted: false })),
        revision: 1,
        sourceDevice: args.installationId,
        createdAt: Date.now(),
      });
      collection = await ctx.db.get(collectionId);
    }
    if (!collection)
      return fail('The account’s synced bookmarks are unavailable. Try again later.');
    const devices = await ctx.db
      .query('devices')
      .withIndex('by_collection', (q) => q.eq('collectionId', collection._id))
      .collect();
    if (devices.filter((d) => !d.revoked).length >= 10)
      fail('This account already has 10 connected browsers. Disconnect one before adding another.');
    const deviceId = await ctx.db.insert('devices', {
      ownerId: user._id,
      collectionId: collection._id,
      installationId: args.installationId,
      name: label(args.name),
      browser: label(args.browser),
      lastSeen: Date.now(),
      cursor: 0,
      sequence: 0,
      revoked: false,
    });
    if (joining && args.choice === 'local') {
      validateTree(args.nodes);
      // Fence replaced identities so delayed edits cannot revive the old tree.
      const revision = collection.revision + 1;
      const oldIds = new Set(collection.nodes.map((n) => n.id));
      if (args.nodes.some((n) => oldIds.has(n.id)))
        fail('Crossmark could not prepare the replacement bookmarks. Cancel and connect again.');
      for (const n of args.nodes) {
        const retired = await ctx.db
          .query('retiredNodes')
          .withIndex('by_node', (q) => q.eq('collectionId', collection!._id).eq('nodeId', n.id))
          .unique();
        if (retired)
          fail('Crossmark could not prepare the replacement bookmarks. Cancel and connect again.');
      }
      await compactDeleted(
        ctx,
        collection._id,
        collection.nodes.map((n) => ({ ...n, deleted: true, revision })),
      );
      const nodes = args.nodes
        .filter((n) => !n.deleted)
        .map((n) => ({ ...n, revision, deleted: false }));
      validateTree(nodes);
      await ctx.db.insert('backups', {
        collectionId: collection._id,
        deviceId,
        nodes: collection.nodes,
        at: Date.now(),
        reason: 'Before replacing account bookmarks',
      });
      await ctx.db.patch(collection._id, { nodes, revision, sourceDevice: args.installationId });
      return { deviceId, joining: false };
    }
    if (!joining)
      await ctx.db.insert('backups', {
        collectionId: collection._id,
        deviceId,
        nodes: collection.nodes,
        at: Date.now(),
        reason: 'First browser snapshot',
      });
    return { deviceId, joining };
  },
});
// A registration response may be lost after commit, so cancellation must retire
// the authenticated installation even when the client has never received its device ID.
export const cancelRegistration = mutation({
  args: { installationId: v.string() },
  handler: async (ctx, { installationId }) => {
    const user = await authComponent.getAuthUser(ctx);
    const device = await installation(ctx, user._id, installationId);
    if (device && !device.revoked) await ctx.db.patch(device._id, { revoked: true });
  },
});
// Older extensions still call join after showing their former merge review.
// Return no adopted identities so they install the cloud tree without adding
// local bookmarks to it. New extensions never call this mutation.
export const join = mutation({
  args: { deviceId: v.id('devices'), nodes: v.array(node) },
  handler: async (ctx, { deviceId }) => {
    const device = await authenticate(ctx, deviceId);
    if (device.joinMatches) return device.joinMatches;
    if (device.sequence !== 0) return fail('This browser has already uploaded changes.');
    await ctx.db.patch(deviceId, { joinMatches: [], lastSeen: Date.now() });
    return [];
  },
});
export const snapshot = query({
  args: { deviceId: v.id('devices') },
  handler: async (ctx, { deviceId }) => {
    const device = await authenticate(ctx, deviceId);
    const collection = await ctx.db.get(device.collectionId);
    if (!collection)
      return fail('The account’s synced bookmarks are unavailable. Try again later.');
    const devices = await ctx.db
      .query('devices')
      .withIndex('by_collection', (q) => q.eq('collectionId', device.collectionId))
      .collect();
    const history = await ctx.db
      .query('operations')
      .withIndex('by_collection', (q) => q.eq('collectionId', device.collectionId))
      .order('desc')
      .take(500);
    const changes: Activity[] = [];
    for (const h of history) {
      const kind = activityKind(h.kind as Operation['kind'], h.before, h.after);
      if (kind) changes.push({ id: h._id, kind, title: h.title, at: h.at });
    }
    const syncs: Activity[] = devices
      .filter((d) => !d.revoked && d.lastSync)
      .map((d) => ({ id: `sync:${d._id}`, kind: 'synced', title: d.name, at: d.lastSync! }));
    return {
      nodes: collection.nodes,
      revision: collection.revision,
      devices: devices.map((d) => ({
        id: d._id,
        name: d.name,
        lastSeen: d.lastSeen,
        cursor: d.cursor,
        revoked: d.revoked,
        paused: d.paused ?? false,
      })),
      activity: [...syncs, ...changes].sort((a, b) => b.at - a.at).slice(0, 100),
    };
  },
});
// Keep the live subscription small; the extension fetches the full snapshot
// through its journaled exchange only when something relevant changes.
export const signal = query({
  args: { deviceId: v.id('devices') },
  handler: async (ctx, { deviceId }) => {
    const device = await authenticate(ctx, deviceId);
    const collection = await ctx.db.get(device.collectionId);
    if (!collection)
      return fail('The account’s synced bookmarks are unavailable. Try again later.');
    const devices = await ctx.db
      .query('devices')
      .withIndex('by_collection', (q) => q.eq('collectionId', device.collectionId))
      .collect();
    return {
      revision: collection.revision,
      paused: device.paused ?? false,
      devices: devices.map((d) => ({
        id: d._id,
        paused: d.paused ?? false,
        revoked: d.revoked,
      })),
    };
  },
});
export const push = mutation({
  args: { deviceId: v.id('devices'), operations: v.array(operation) },
  handler: async (ctx, { deviceId, operations }) => {
    const device = await authenticate(ctx, deviceId);
    const collection = await ctx.db.get(device.collectionId);
    if (!collection)
      return fail('The account’s synced bookmarks are unavailable. Try again later.');
    if (
      operations.length > 500 ||
      new TextEncoder().encode(JSON.stringify(operations)).byteLength > 600_000
    )
      fail('Too many bookmark changes to send at once.');
    // Move legacy/full tombstones out of the bounded snapshot atomically.
    let nodes: Node[] = await compactDeleted(ctx, collection._id, collection.nodes);
    const beforeBatch = nodes;
    let revision = collection.revision;
    let sequence = device.sequence;
    const acknowledged: string[] = [];
    for (const op of operations) {
      if (
        op.id.length > 100 ||
        !Number.isSafeInteger(op.sequence) ||
        op.sequence < 1 ||
        !Number.isSafeInteger(op.baseRevision) ||
        op.baseRevision < 0 ||
        op.baseRevision > revision
      )
        fail('Invalid operation version.');
      // Sequence is the durable receipt after detailed history has expired.
      if (op.sequence <= sequence) {
        const receipt = await ctx.db
          .query('operations')
          .withIndex('by_sequence', (q) => q.eq('deviceId', device._id).eq('sequence', op.sequence))
          .unique();
        if (receipt && receipt.operationId !== op.id)
          fail(
            'This browser reused a sync sequence. Export local bookmarks, then disconnect and reconnect.',
          );
        acknowledged.push(op.id);
        continue;
      }
      const existing = await ctx.db
        .query('operations')
        .withIndex('by_operation', (q) => q.eq('deviceId', device._id).eq('operationId', op.id))
        .unique();
      if (existing) {
        acknowledged.push(op.id);
        continue;
      }
      if (op.sequence !== sequence + 1)
        fail('Some earlier bookmark changes have not been sent. Retry syncing first.');
      const retired = await ctx.db
        .query('retiredNodes')
        .withIndex('by_node', (q) => q.eq('collectionId', collection._id).eq('nodeId', op.nodeId))
        .unique();
      const prior =
        retired && op.kind === 'update'
          ? await ctx.db
              .query('operations')
              .withIndex('by_node', (q) =>
                q.eq('collectionId', collection._id).eq('nodeId', op.nodeId),
              )
              .order('desc')
              .first()
          : undefined;
      ++revision;
      // Stale create/restore/update/delete all drain as conflicts. Never recreate
      // a retired identity, even for an arbitrarily old offline installation.
      const result = retired
        ? { nodes, before: prior?.after, after: prior?.after, conflict: true }
        : applyOperation(nodes, op, revision, true);
      nodes = await compactDeleted(ctx, collection._id, result.nodes);
      sequence = op.sequence;
      await ctx.db.insert('operations', {
        collectionId: device.collectionId,
        deviceId: device._id,
        operationId: op.id,
        sequence,
        revision,
        nodeId: op.nodeId,
        title: result.after?.title ?? result.before?.title ?? 'Untitled',
        kind: op.kind,
        device: device.name,
        at: Date.now(),
        conflict: result.conflict,
        ...(result.before ? { before: result.before } : {}),
        ...(result.after ? { after: result.after } : {}),
        ...(result.before?.deleted && op.kind === 'update'
          ? { attempted: { ...result.before, ...op.fields, deleted: false } }
          : {}),
      });
      acknowledged.push(op.id);
    }
    // A queued create/growing edit can precede deletes in the durable outbox.
    // Validate only the net persisted snapshot, rolling back all fences/receipts
    // if the batch neither fits nor strictly shrinks a legacy over-budget tree.
    validateTree(nodes, beforeBatch);
    await ctx.db.patch(collection._id, { nodes, revision });
    await ctx.db.patch(device._id, { sequence, lastSeen: Date.now() });
    return { acknowledged, revision };
  },
});
export const checkpoint = mutation({
  args: { deviceId: v.id('devices'), cursor: v.number() },
  handler: async (ctx, { deviceId, cursor }) => {
    const device = await authenticate(ctx, deviceId);
    const collection = await ctx.db.get(device.collectionId);
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < device.cursor ||
      cursor > (collection?.revision ?? 0)
    )
      fail('Invalid checkpoint.');
    // A browser syncs when it applies revisions from elsewhere, not only its own pushes.
    // Revision 1 is the collection seed, which has no operation row.
    const received =
      cursor > device.cursor &&
      ((device.cursor === 0 && collection!.sourceDevice !== device.installationId) ||
        !!(await ctx.db
          .query('operations')
          .withIndex('by_collection', (q) =>
            q
              .eq('collectionId', device.collectionId)
              .gt('revision', device.cursor)
              .lte('revision', cursor),
          )
          .filter((q) => q.neq(q.field('deviceId'), device._id))
          .first()));
    const now = Date.now();
    await ctx.db.patch(device._id, {
      cursor,
      lastSeen: now,
      ...(received ? { lastSync: now } : {}),
    });
  },
});
export const backup = mutation({
  args: { deviceId: v.id('devices'), nodes: v.array(node), reason: v.string() },
  handler: async (ctx, { deviceId, nodes, reason }) => {
    const device = await authenticate(ctx, deviceId);
    validateTree(nodes);
    const recent = await ctx.db
      .query('backups')
      .withIndex('by_collection', (q) => q.eq('collectionId', device.collectionId))
      .order('desc')
      .take(20);
    // Keep at most ten recent backups once any legacy backlog has expired.
    for (const old of recent.slice(9)) await ctx.db.delete(old._id);
    await ctx.db.insert('backups', {
      collectionId: device.collectionId,
      deviceId: device._id,
      nodes,
      reason: reason.slice(0, 100),
      at: Date.now(),
    });
  },
});
async function target(ctx: MutationCtx, deviceId: Id<'devices'>, targetDeviceId: Id<'devices'>) {
  const device = await authenticate(ctx, deviceId);
  const target = await ctx.db.get(targetDeviceId);
  if (!target || target.collectionId !== device.collectionId || target.ownerId !== device.ownerId)
    return fail('Browser not found.');
  return target;
}
export const revoke = mutation({
  args: { deviceId: v.id('devices'), targetDeviceId: v.id('devices') },
  handler: async (ctx, { deviceId, targetDeviceId }) => {
    await target(ctx, deviceId, targetDeviceId);
    await ctx.db.patch(targetDeviceId, { revoked: true });
  },
});
// Any browser in the collection may pause another; the target adopts the flag on its next exchange.
export const setPaused = mutation({
  args: { deviceId: v.id('devices'), targetDeviceId: v.id('devices'), paused: v.boolean() },
  handler: async (ctx, { deviceId, targetDeviceId, paused }) => {
    if ((await target(ctx, deviceId, targetDeviceId)).revoked) fail('Browser not found.');
    await ctx.db.patch(targetDeviceId, { paused });
  },
});
export const pauseState = query({
  args: { deviceId: v.id('devices') },
  handler: async (ctx, { deviceId }) => (await authenticate(ctx, deviceId)).paused ?? false,
});
