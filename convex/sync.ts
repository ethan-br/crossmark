import { v, ConvexError } from 'convex/values';
import { mutation, query, type QueryCtx, type MutationCtx } from './_generated/server';
import { node, operation } from './schema';
import { authComponent } from './auth';
import type { Id } from './_generated/dataModel';
import { validateTree, type Activity, type Node, type Operation } from '../packages/model';
import { activityKind, applyOperation } from '../packages/sync-core';
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
// Answers what connect would report as `joining`, so the popup can confirm first.
export const joinsExisting = query({
  args: { installationId: v.string() },
  handler: async (ctx, { installationId }) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!/^[a-f0-9-]{36}$/.test(installationId)) fail('Invalid installation ID.');
    const existing = await installation(ctx, user._id, installationId);
    if (existing?.revoked) fail('This installation was revoked. Sign out before signing in again.');
    if (existing) return (await ctx.db.get(existing.collectionId))?.sourceDevice !== installationId;
    return !!(await ownedCollection(ctx, user._id));
  },
});
export const connect = mutation({
  args: { installationId: v.string(), name: v.string(), browser: v.string(), nodes: v.array(node) },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!/^[a-f0-9-]{36}$/.test(args.installationId)) fail('Invalid installation ID.');
    const existing = await installation(ctx, user._id, args.installationId);
    if (existing) {
      if (existing.revoked)
        fail('This installation was revoked. Sign out before signing in again.');
      const collection = await ctx.db.get(existing.collectionId);
      return { deviceId: existing._id, joining: collection?.sourceDevice !== args.installationId };
    }
    let collection = await ownedCollection(ctx, user._id);
    const joining = !!collection;
    if (!collection) {
      validateTree(args.nodes);
      const collectionId = await ctx.db.insert('collections', {
        ownerId: user._id,
        nodes: args.nodes.map((n) => ({ ...n, revision: 1, deleted: false })),
        revision: 1,
        sourceDevice: args.installationId,
        createdAt: Date.now(),
      });
      collection = await ctx.db.get(collectionId);
    }
    if (!collection) return fail('Collection unavailable.');
    const devices = await ctx.db
      .query('devices')
      .withIndex('by_collection', (q) => q.eq('collectionId', collection._id))
      .collect();
    if (devices.filter((d) => !d.revoked).length >= 10)
      fail('This collection already has 10 browsers.');
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
    if (!collection) return fail('Collection unavailable.');
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
export const push = mutation({
  args: { deviceId: v.id('devices'), operations: v.array(operation) },
  handler: async (ctx, { deviceId, operations }) => {
    const device = await authenticate(ctx, deviceId);
    const collection = await ctx.db.get(device.collectionId);
    if (!collection) return fail('Collection unavailable.');
    if (operations.length > 500 || JSON.stringify(operations).length > 600_000)
      fail('Sync batch is too large.');
    let nodes: Node[] = collection.nodes;
    let revision = collection.revision;
    let sequence = device.sequence;
    const acknowledged: string[] = [];
    for (const op of operations) {
      if (
        op.id.length > 100 ||
        !Number.isSafeInteger(op.sequence) ||
        !Number.isSafeInteger(op.baseRevision) ||
        op.baseRevision < 0 ||
        op.baseRevision > revision
      )
        fail('Invalid operation version.');
      const existing = await ctx.db
        .query('operations')
        .withIndex('by_operation', (q) => q.eq('deviceId', device._id).eq('operationId', op.id))
        .unique();
      if (existing) {
        acknowledged.push(op.id);
        continue;
      }
      if (op.sequence !== sequence + 1)
        fail('Out-of-order operation. Retry the pending batch first.');
      const result = applyOperation(nodes, op, ++revision);
      nodes = result.nodes;
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
