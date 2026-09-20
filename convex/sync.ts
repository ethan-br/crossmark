import { v, ConvexError } from 'convex/values';
import { mutation, query, type QueryCtx, type MutationCtx } from './_generated/server';
import { node, operation } from './schema';
import { authComponent } from './auth';
import type { Id } from './_generated/dataModel';
import { validateTree, type Node, type Operation } from '../packages/model';
import { applyOperation } from '../packages/sync-core';
import { reconcileJoin } from '../packages/sync-core/join';
const fail = (message: string): never => {
  throw new ConvexError(message);
};
async function authenticate(ctx: QueryCtx | MutationCtx, deviceId: Id<'devices'>) {
  const user = await authComponent.getAuthUser(ctx);
  const device = await ctx.db.get(deviceId);
  if (!device || device.revoked || device.ownerId !== user._id)
    return fail('This browser is disconnected. Sign in with Google to reconnect.');
  return device;
}
function label(value: string) {
  if (!value.trim() || value.length > 80) fail('Use a browser name between 1 and 80 characters.');
  return value.trim();
}
export const connect = mutation({
  args: { installationId: v.string(), name: v.string(), browser: v.string(), nodes: v.array(node) },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!/^[a-f0-9-]{36}$/.test(args.installationId)) fail('Invalid installation ID.');
    const existing = await ctx.db
      .query('devices')
      .withIndex('by_installation', (q) =>
        q.eq('ownerId', user._id).eq('installationId', args.installationId),
      )
      .unique();
    if (existing) {
      if (existing.revoked)
        fail('This installation was revoked. Sign out before signing in again.');
      const collection = await ctx.db.get(existing.collectionId);
      return { deviceId: existing._id, joining: collection?.sourceDevice !== args.installationId };
    }
    let collection = await ctx.db
      .query('collections')
      .withIndex('by_owner', (q) => q.eq('ownerId', user._id))
      .unique();
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
// Import against the current collection in one transaction. Persist the result
// so a lost response cannot repeat the import or change native identity adoption.
export const join = mutation({
  args: { deviceId: v.id('devices'), nodes: v.array(node) },
  handler: async (ctx, { deviceId, nodes: local }) => {
    const device = await authenticate(ctx, deviceId);
    if (device.joinMatches) return device.joinMatches;
    const collection = await ctx.db.get(device.collectionId);
    if (!collection) return fail('Collection unavailable.');
    if (device.sequence !== 0) return fail('This browser has already uploaded changes.');
    const { additions, matches } = reconcileJoin(collection.nodes, local);
    const nodes: Node[] = [...collection.nodes];
    let revision = collection.revision;
    for (const node of additions) {
      const added = { ...node, revision: ++revision, deleted: false };
      nodes.push(added);
      await ctx.db.insert('operations', {
        collectionId: device.collectionId,
        deviceId,
        operationId: `join:${node.id}`,
        sequence: 0,
        revision,
        nodeId: node.id,
        title: node.title,
        kind: 'create',
        device: device.name,
        at: Date.now(),
        conflict: false,
        after: added,
      });
    }
    validateTree(nodes);
    await ctx.db.patch(collection._id, { nodes, revision });
    await ctx.db.patch(deviceId, { joinMatches: matches, lastSeen: Date.now() });
    return matches;
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
      .take(100);
    return {
      nodes: collection.nodes,
      revision: collection.revision,
      devices: devices.map((d) => ({
        id: d._id,
        name: d.name,
        browser: d.browser,
        lastSeen: d.lastSeen,
        cursor: d.cursor,
        revoked: d.revoked,
      })),
      activity: history.map((h) => ({
        id: h._id,
        nodeId: h.nodeId,
        title: h.title,
        kind: h.kind,
        device: h.device,
        at: h.at,
        conflict: h.conflict,
        ...(h.before ? { before: h.before } : {}),
        ...(h.after ? { after: h.after } : {}),
        ...(h.attempted ? { attempted: h.attempted } : {}),
      })),
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
    await ctx.db.patch(device._id, { cursor, lastSeen: Date.now() });
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
export const revoke = mutation({
  args: { deviceId: v.id('devices'), targetDeviceId: v.id('devices') },
  handler: async (ctx, { deviceId, targetDeviceId }) => {
    const device = await authenticate(ctx, deviceId);
    const target = await ctx.db.get(targetDeviceId);
    if (!target || target.collectionId !== device.collectionId || target.ownerId !== device.ownerId)
      fail('Browser not found.');
    await ctx.db.patch(targetDeviceId, { revoked: true });
  },
});
