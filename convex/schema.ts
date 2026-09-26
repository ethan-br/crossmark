import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
export const node = v.object({
  id: v.string(),
  kind: v.union(v.literal('bookmark'), v.literal('folder'), v.literal('separator')),
  parentId: v.string(),
  order: v.number(),
  title: v.string(),
  url: v.optional(v.string()),
  revision: v.number(),
  deleted: v.optional(v.boolean()),
});
export const operation = v.object({
  id: v.string(),
  sequence: v.number(),
  nodeId: v.string(),
  baseRevision: v.number(),
  kind: v.union(
    v.literal('create'),
    v.literal('update'),
    v.literal('delete'),
    // No longer emitted; still accepted so outboxes queued by earlier clients can drain.
    v.literal('restore'),
  ),
  node: v.optional(node),
  fields: v.optional(
    v.object({
      title: v.optional(v.string()),
      url: v.optional(v.string()),
      parentId: v.optional(v.string()),
      order: v.optional(v.number()),
    }),
  ),
});
export default defineSchema({
  collections: defineTable({
    ownerId: v.optional(v.string()),
    nodes: v.array(node),
    revision: v.number(),
    sourceDevice: v.string(),
    createdAt: v.number(),
  }).index('by_owner', ['ownerId']),
  devices: defineTable({
    collectionId: v.id('collections'),
    ownerId: v.optional(v.string()),
    installationId: v.optional(v.string()),
    name: v.string(),
    browser: v.string(),
    lastSeen: v.number(),
    lastSync: v.optional(v.number()),
    cursor: v.number(),
    sequence: v.number(),
    revoked: v.boolean(),
    joinMatches: v.optional(v.array(v.object({ localId: v.string(), nodeId: v.string() }))),
  })
    .index('by_installation', ['ownerId', 'installationId'])
    .index('by_collection', ['collectionId']),
  operations: defineTable({
    collectionId: v.id('collections'),
    deviceId: v.id('devices'),
    operationId: v.string(),
    sequence: v.number(),
    revision: v.number(),
    nodeId: v.string(),
    title: v.string(),
    kind: v.string(),
    device: v.string(),
    at: v.number(),
    conflict: v.boolean(),
    before: v.optional(node),
    after: v.optional(node),
    attempted: v.optional(node),
  })
    .index('by_operation', ['deviceId', 'operationId'])
    .index('by_collection', ['collectionId', 'revision']),
  backups: defineTable({
    collectionId: v.id('collections'),
    deviceId: v.id('devices'),
    nodes: v.array(node),
    at: v.number(),
    reason: v.string(),
  }).index('by_collection', ['collectionId']),
});
