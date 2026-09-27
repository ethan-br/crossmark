import { expect, it } from 'vitest';
import betterAuth from '@convex-dev/better-auth/test';
import { components, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { authenticatedBackend } from './fixtures/auth';

it('clears every app and Better Auth table in batches and can be rerun', async () => {
  const { unauthenticated, account } = await authenticatedBackend();
  const now = Date.now();
  const collectionId = await unauthenticated.run((ctx) =>
    ctx.db.insert('collections', {
      nodes: [],
      revision: 0,
      sourceDevice: 'test',
      createdAt: now,
    }),
  );
  const deviceId = await unauthenticated.run((ctx) =>
    ctx.db.insert('devices', {
      collectionId,
      name: 'Test',
      browser: 'Chrome',
      lastSeen: now,
      cursor: 0,
      sequence: 0,
      revoked: false,
    }),
  );
  await unauthenticated.run(async (ctx) => {
    await ctx.db.insert('operations', {
      collectionId,
      deviceId,
      operationId: 'op',
      sequence: 1,
      revision: 1,
      nodeId: 'node',
      title: 'Node',
      kind: 'create',
      device: 'Test',
      at: now,
      conflict: false,
    });
    for (let i = 0; i < 101; i++) {
      await ctx.db.insert('backups', {
        collectionId,
        deviceId,
        nodes: [],
        at: now,
        reason: `test-${i}`,
      });
    }
  });

  const authRows = [
    {
      model: 'verification',
      data: { identifier: 'test', value: 'code', expiresAt: now, createdAt: now, updatedAt: now },
    },
    { model: 'twoFactor', data: { secret: 'secret', backupCodes: 'codes', userId: 'test' } },
    { model: 'oauthApplication', data: { clientId: 'test' } },
    { model: 'oauthAccessToken', data: { accessToken: 'test' } },
    { model: 'oauthConsent', data: { clientId: 'test' } },
    { model: 'jwks', data: { publicKey: 'public', privateKey: 'private', createdAt: now } },
  ] as const;
  for (const row of authRows) {
    await unauthenticated.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.create, { input: row }),
    );
  }
  for (let i = 0; i < 101; i++) {
    await unauthenticated.run((ctx) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        input: { model: 'rateLimit', data: { key: `test-${i}`, count: 1, lastRequest: now } },
      }),
    );
  }
  // The fixture account contributes user and session rows.
  await account('another@example.com');
  await unauthenticated.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'account',
        data: {
          accountId: 'test',
          providerId: 'credential',
          userId: 'test',
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );

  await expect(
    unauthenticated.action(internal.maintenance.clearAll, { confirm: 'no' as 'DELETE_ALL_DATA' }),
  ).rejects.toThrow();
  const deleted = await unauthenticated.action(internal.maintenance.clearAll, {
    confirm: 'DELETE_ALL_DATA',
  });
  expect(deleted).toMatchObject({
    collections: 1,
    devices: 1,
    operations: 1,
    backups: 101,
    'betterAuth.user': 2,
    'betterAuth.session': 2,
    'betterAuth.account': 1,
    'betterAuth.rateLimit': 101,
  });
  expect(Object.keys(deleted).sort()).toEqual(
    [
      ...Object.keys(schema.tables),
      ...Object.keys(betterAuth.schema.tables).map((table) => `betterAuth.${table}`),
    ].sort(),
  );
  await unauthenticated.run(async (ctx) => {
    for (const table of Object.keys(schema.tables)) {
      expect(await ctx.db.query(table as keyof typeof schema.tables).first()).toBeNull();
    }
    for (const model of Object.keys(betterAuth.schema.tables)) {
      const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: model as 'user',
        paginationOpts: { numItems: 1, cursor: null },
      });
      expect(result.page).toEqual([]);
    }
  });
  expect(
    await unauthenticated.action(internal.maintenance.clearAll, {
      confirm: 'DELETE_ALL_DATA',
    }),
  ).toEqual(Object.fromEntries(Object.keys(deleted).map((table) => [table, 0])));
});
