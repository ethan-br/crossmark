import { v } from 'convex/values';
import type { TableNames } from './_generated/dataModel';
import { components, internal } from './_generated/api';
import { internalAction, internalMutation } from './_generated/server';
import schema from './schema';

const batchSize = 100;

// Delete dependent records before users. Keep this list in sync with the installed
// Better Auth component schema; its tables cannot be queried through the app db.
const authTables = [
  'session',
  'account',
  'verification',
  'twoFactor',
  'oauthAccessToken',
  'oauthConsent',
  'oauthApplication',
  'rateLimit',
  'user',
  'jwks',
] as const;

/** Operator-only: run with `npx convex run maintenance:clearAll '{"confirm":"DELETE_ALL_DATA"}'`. */
export const clearAll = internalAction({
  args: { confirm: v.literal('DELETE_ALL_DATA') },
  handler: async (ctx) => {
    const deleted: Record<string, number> = {};

    for (const table of Object.keys(schema.tables)) {
      let count = 0;
      let batch: number;
      do {
        batch = await ctx.runMutation(internal.maintenance.clearAppBatch, { table });
        count += batch;
      } while (batch > 0);
      deleted[table] = count;
    }

    for (const model of authTables) {
      let count = 0;
      let batch: number;
      do {
        const result = await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
          input: { model },
          paginationOpts: { numItems: batchSize, cursor: null },
        });
        batch = result.count;
        count += batch;
      } while (batch > 0);
      deleted[`betterAuth.${model}`] = count;
    }

    return deleted;
  },
});

export const clearAppBatch = internalMutation({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    if (!(table in schema.tables)) throw new Error(`Unknown app table: ${table}`);
    const docs = await ctx.db.query(table as TableNames).take(batchSize);
    for (const doc of docs) await ctx.db.delete(doc._id);
    return docs.length;
  },
});

// Bounded transactions also handle existing deployments with a retention backlog.
export const expireRetention = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const history = await ctx.db
      .query('operations')
      .withIndex('by_at', (q) => q.lt('at', now - 30 * 86400000))
      .take(100);
    const backups = await ctx.db
      .query('backups')
      .withIndex('by_at', (q) => q.lt('at', now - 7 * 86400000))
      .take(20);
    for (const row of [...history, ...backups]) await ctx.db.delete(row._id);
    if (history.length === 100 || backups.length === 20)
      await ctx.scheduler.runAfter(0, internal.maintenance.expireRetention, {});
    return { operations: history.length, backups: backups.length };
  },
});
