import { authenticatedBackend } from './fixtures/auth';
import { describe, it, expect } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Node } from '../packages/model';
const installationId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const node: Node = {
  id: 'a',
  kind: 'bookmark',
  parentId: 'toolbar',
  title: 'A',
  url: 'https://example.com',
  order: 0,
  revision: 0,
};
async function setup() {
  const env = await authenticatedBackend();
  const { t } = env;
  const first = await t.mutation(api.sync.connect, {
    installationId,
    name: 'First',
    browser: 'Chromium',
    nodes: [node],
  });
  return { ...env, first, deviceId: first.deviceId };
}
describe('Convex authorization and durable operations', () => {
  it('initializes once, including idempotent retries', async () => {
    const { t, deviceId } = await setup();
    await t.mutation(api.sync.connect, {
      installationId,
      name: 'Retry',
      browser: 'Chromium',
      nodes: [],
    });
    expect((await t.query(api.sync.snapshot, { deviceId })).nodes).toHaveLength(1);
  });
  it('rejects unauthenticated, expired sessions and revoked devices', async () => {
    const { t, unauthenticated, account, deviceId } = await setup();
    await expect(unauthenticated.query(api.sync.signal, { deviceId })).rejects.toThrow(
      'Unauthenticated',
    );
    await expect(unauthenticated.query(api.sync.snapshot, { deviceId })).rejects.toThrow(
      'Unauthenticated',
    );
    const expired = await account('expired@example.com', Date.now() - 1000);
    await expect(expired.t.query(api.sync.snapshot, { deviceId })).rejects.toThrow(
      'Unauthenticated',
    );
    await t.mutation(api.sync.revoke, { deviceId, targetDeviceId: deviceId });
    await expect(t.query(api.sync.snapshot, { deviceId })).rejects.toThrow('disconnected');
    await expect(t.query(api.sync.signal, { deviceId })).rejects.toThrow('disconnected');
  });
  it('isolates accounts on reads, writes and revocation', async () => {
    const { t, account, deviceId } = await setup();
    const other = await account('other@example.com');
    const second = await other.t.mutation(api.sync.connect, {
      installationId,
      name: 'Other',
      browser: 'Firefox',
      nodes: [],
    });
    await expect(t.query(api.sync.snapshot, { deviceId: second.deviceId })).rejects.toThrow(
      'disconnected',
    );
    await expect(t.query(api.sync.signal, { deviceId: second.deviceId })).rejects.toThrow(
      'disconnected',
    );
    await expect(
      t.mutation(api.sync.push, { deviceId: second.deviceId, operations: [] }),
    ).rejects.toThrow('disconnected');
    await expect(
      t.mutation(api.sync.revoke, { deviceId, targetDeviceId: second.deviceId }),
    ).rejects.toThrow('not found');
    expect((await other.t.query(api.sync.snapshot, { deviceId: second.deviceId })).nodes).toEqual(
      [],
    );
  });
  it('connects the same account without reseeding its existing collection', async () => {
    const { t } = await setup();
    const second = await t.mutation(api.sync.connect, {
      installationId: crypto.randomUUID(),
      name: 'Second',
      browser: 'Firefox',
      nodes: [],
    });
    expect(second.joining).toBe(true);
    expect((await t.query(api.sync.snapshot, { deviceId: second.deviceId })).nodes).toHaveLength(1);
  });
  it('reports whether connecting would join an existing collection', async () => {
    const { t, account } = await authenticatedBackend();
    expect(await t.query(api.sync.joinsExisting, { installationId })).toBe(false);
    await t.mutation(api.sync.connect, {
      installationId,
      name: 'First',
      browser: 'Chromium',
      nodes: [node],
    });
    // The seeding installation reconnects to its own collection without replacing anything.
    expect(await t.query(api.sync.joinsExisting, { installationId })).toBe(false);
    expect(await t.query(api.sync.joinsExisting, { installationId: crypto.randomUUID() })).toBe(
      true,
    );
    const other = await account('other@example.com');
    expect(await other.t.query(api.sync.joinsExisting, { installationId })).toBe(false);
  });
  it('rejects malformed and revoked installations before connecting', async () => {
    const { t, deviceId } = await setup();
    await expect(t.query(api.sync.joinsExisting, { installationId: 'nope' })).rejects.toThrow(
      'Invalid installation ID',
    );
    await t.mutation(api.sync.revoke, { deviceId, targetDeviceId: deviceId });
    await expect(t.query(api.sync.joinsExisting, { installationId })).rejects.toThrow(
      'was revoked',
    );
  });
  it('does not import local nodes when an older joining extension calls join', async () => {
    const { t } = await setup();
    const second = await t.mutation(api.sync.connect, {
      installationId: crypto.randomUUID(),
      name: 'Second',
      browser: 'Firefox',
      nodes: [],
    });
    const local = { ...node, id: 'local', url: 'https://local.example' };
    expect(await t.mutation(api.sync.join, { deviceId: second.deviceId, nodes: [local] })).toEqual(
      [],
    );
    expect((await t.query(api.sync.snapshot, { deviceId: second.deviceId })).nodes).toEqual([
      { ...node, revision: 1, deleted: false },
    ]);
  });
  it('deduplicates repeated upload after lost acknowledgment', async () => {
    const { t, deviceId } = await setup();
    const operations = [
      {
        id: 'one',
        sequence: 1,
        nodeId: 'a',
        baseRevision: 1,
        kind: 'update' as const,
        fields: { parentId: 'other' },
      },
    ];
    await t.mutation(api.sync.push, { deviceId, operations });
    await t.mutation(api.sync.push, { deviceId, operations });
    const snapshot = await t.query(api.sync.snapshot, { deviceId });
    expect(snapshot.revision).toBe(2);
    expect((await t.query(api.sync.signal, { deviceId })).revision).toBe(2);
    expect(snapshot.activity).toEqual([expect.objectContaining({ kind: 'moved', title: 'A' })]);
    expect(snapshot.nodes[0].parentId).toBe('other');
  });
  it('rejects out-of-order sequences and rolls back atomic batches', async () => {
    const { t, deviceId } = await setup();
    await expect(
      t.mutation(api.sync.push, {
        deviceId,
        operations: [{ id: 'bad', sequence: 2, nodeId: 'a', baseRevision: 1, kind: 'delete' }],
      }),
    ).rejects.toThrow('Out-of-order');
    expect((await t.query(api.sync.snapshot, { deviceId })).revision).toBe(1);
  });
  it('pauses another browser in the same collection only', async () => {
    const { t, account, deviceId } = await setup();
    const second = await t.mutation(api.sync.connect, {
      installationId: crypto.randomUUID(),
      name: 'Second',
      browser: 'Firefox',
      nodes: [],
    });
    expect(await t.query(api.sync.pauseState, { deviceId: second.deviceId })).toBe(false);
    await t.mutation(api.sync.setPaused, {
      deviceId,
      targetDeviceId: second.deviceId,
      paused: true,
    });
    expect(await t.query(api.sync.pauseState, { deviceId: second.deviceId })).toBe(true);
    const devices = (await t.query(api.sync.snapshot, { deviceId })).devices;
    expect(devices.find((d) => d.id === second.deviceId)?.paused).toBe(true);
    expect(devices.find((d) => d.id === deviceId)?.paused).toBe(false);
    const other = await account('other@example.com');
    const outsider = await other.t.mutation(api.sync.connect, {
      installationId,
      name: 'Other',
      browser: 'Firefox',
      nodes: [],
    });
    await expect(
      t.mutation(api.sync.setPaused, {
        deviceId,
        targetDeviceId: outsider.deviceId,
        paused: true,
      }),
    ).rejects.toThrow('not found');
    await t.mutation(api.sync.revoke, { deviceId, targetDeviceId: second.deviceId });
    await expect(
      t.mutation(api.sync.setPaused, {
        deviceId,
        targetDeviceId: second.deviceId,
        paused: false,
      }),
    ).rejects.toThrow('not found');
  });
  it('rejects a checkpoint ahead of the collection', async () => {
    const { t, deviceId } = await setup();
    await expect(t.mutation(api.sync.checkpoint, { deviceId, cursor: 500 })).rejects.toThrow(
      'checkpoint',
    );
  });
});

it('retains the losing edit when a tombstone wins', async () => {
  const { t, deviceId } = await setup();
  await t.mutation(api.sync.push, {
    deviceId,
    operations: [{ id: 'delete', sequence: 1, nodeId: 'a', baseRevision: 1, kind: 'delete' }],
  });
  await t.mutation(api.sync.push, {
    deviceId,
    operations: [
      {
        id: 'stale',
        sequence: 2,
        nodeId: 'a',
        baseRevision: 1,
        kind: 'update',
        fields: { title: 'Recover this offline title' },
      },
    ],
  });
  const snapshot = await t.query(api.sync.snapshot, { deviceId });
  expect(snapshot.nodes).toEqual([]);
  expect(snapshot.activity.map(({ kind, title }) => ({ kind, title }))).toEqual([
    { kind: 'removed', title: 'A' },
  ]);
  const stale = await t.run((ctx) =>
    ctx.db
      .query('operations')
      .filter((q) => q.eq(q.field('operationId'), 'stale'))
      .unique(),
  );
  expect(stale?.attempted?.title).toBe('Recover this offline title');
});

it('limits activity to structural changes and browser syncs', async () => {
  const { t, deviceId } = await setup();
  const folder: Node = {
    id: 'f',
    kind: 'folder',
    parentId: 'toolbar',
    title: 'Folder',
    order: 1,
    revision: 0,
  };
  const operations = [
    { kind: 'update', nodeId: 'a', baseRevision: 1, fields: { title: 'Renamed' } },
    { kind: 'update', nodeId: 'a', baseRevision: 2, fields: { order: 3 } },
    { kind: 'create', nodeId: 'f', baseRevision: 0, node: folder },
    { kind: 'update', nodeId: 'a', baseRevision: 3, fields: { parentId: 'f' } },
    { kind: 'delete', nodeId: 'f', baseRevision: 4 },
  ] as const;
  await t.mutation(api.sync.push, {
    deviceId,
    operations: operations.map((op, i) => ({ ...op, id: `op${i}`, sequence: i + 1 })),
  });
  let snapshot = await t.query(api.sync.snapshot, { deviceId });
  expect(snapshot.activity.map(({ kind, title }) => `${title} ${kind}`)).toEqual([
    'Folder removed',
    'Renamed moved',
    'Folder added',
  ]);
  await t.mutation(api.sync.checkpoint, { deviceId, cursor: snapshot.revision });
  snapshot = await t.query(api.sync.snapshot, { deviceId });
  expect(snapshot.activity.filter((a) => a.kind === 'synced')).toEqual([]);
  const second = await t.mutation(api.sync.connect, {
    installationId: crypto.randomUUID(),
    name: 'Second',
    browser: 'Firefox',
    nodes: [],
  });
  await t.mutation(api.sync.checkpoint, {
    deviceId: second.deviceId,
    cursor: snapshot.revision,
  });
  snapshot = await t.query(api.sync.snapshot, { deviceId });
  expect(snapshot.activity[0]).toMatchObject({ kind: 'synced', title: 'Second' });
  expect(Object.keys(snapshot.activity[0]).sort()).toEqual(['at', 'id', 'kind', 'title']);
  const synced = snapshot.activity[0].at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await t.mutation(api.sync.checkpoint, {
    deviceId: second.deviceId,
    cursor: snapshot.revision,
  });
  snapshot = await t.query(api.sync.snapshot, { deviceId });
  expect(snapshot.activity.filter((a) => a.kind === 'synced')).toEqual([
    expect.objectContaining({ title: 'Second', at: synced }),
  ]);
});

it('marks a browser synced only when it applies changes from elsewhere', async () => {
  const { t, deviceId } = await setup();
  await t.mutation(api.sync.checkpoint, { deviceId, cursor: 1 });
  const second = await t.mutation(api.sync.connect, {
    installationId: crypto.randomUUID(),
    name: 'Second',
    browser: 'Firefox',
    nodes: [],
  });
  await t.mutation(api.sync.checkpoint, { deviceId: second.deviceId, cursor: 1 });
  const synced = async () =>
    (await t.query(api.sync.snapshot, { deviceId })).activity
      .filter((a) => a.kind === 'synced')
      .map(({ title, at }) => ({ title, at }));
  const [joined] = await synced();
  expect(joined.title).toBe('Second');
  await t.mutation(api.sync.push, {
    deviceId: second.deviceId,
    operations: [
      {
        id: 'move',
        sequence: 1,
        nodeId: 'a',
        baseRevision: 1,
        kind: 'update',
        fields: { parentId: 'other' },
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await t.mutation(api.sync.checkpoint, { deviceId: second.deviceId, cursor: 2 });
  await t.mutation(api.sync.checkpoint, { deviceId, cursor: 2 });
  expect(await synced()).toEqual([{ title: 'First', at: expect.any(Number) }, joined]);
});

it('fences retired identities after history expiry and acknowledges old retries', async () => {
  const { t, deviceId } = await setup();
  const deletion = {
    id: 'delete',
    sequence: 1,
    nodeId: 'a',
    baseRevision: 1,
    kind: 'delete' as const,
  };
  await t.mutation(api.sync.push, { deviceId, operations: [deletion] });
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query('operations').collect())
      await ctx.db.patch(row._id, { at: Date.now() - 31 * 86400000 });
  });
  await t.mutation(internal.maintenance.expireRetention, {});
  expect(await t.run((ctx) => ctx.db.query('operations').collect())).toEqual([]);
  expect(
    (await t.mutation(api.sync.push, { deviceId, operations: [deletion] })).acknowledged,
  ).toEqual(['delete']);
  for (const [i, kind] of (['create', 'restore', 'update', 'delete'] as const).entries()) {
    await t.mutation(api.sync.push, {
      deviceId,
      operations: [
        {
          id: `stale-${kind}`,
          sequence: i + 2,
          nodeId: 'a',
          baseRevision: 0,
          kind,
          node,
          fields: { title: 'Offline' },
        },
      ],
    });
  }
  expect((await t.query(api.sync.snapshot, { deviceId })).nodes).toEqual([]);
  await t.mutation(api.sync.push, {
    deviceId,
    operations: [
      {
        id: 'new',
        sequence: 6,
        nodeId: 'fresh',
        baseRevision: 0,
        kind: 'create',
        node: { ...node, id: 'fresh' },
      },
    ],
  });
  expect((await t.query(api.sync.snapshot, { deviceId })).nodes.map((n) => n.id)).toEqual([
    'fresh',
  ]);
});

it('frees snapshot slots for churn and fences all deleted descendants', async () => {
  const { t, deviceId } = await setup();
  await t.run(async (ctx) => {
    const d = (await ctx.db.get(deviceId))!;
    await ctx.db.patch(d.collectionId, {
      nodes: [
        { ...node, id: 'folder', kind: 'folder', url: undefined },
        ...Array.from({ length: 1999 }, (_, i) => ({
          ...node,
          id: `child${i}`,
          parentId: 'folder',
        })),
      ],
    });
  });
  await t.mutation(api.sync.push, {
    deviceId,
    operations: [
      { id: 'remove-tree', sequence: 1, nodeId: 'folder', baseRevision: 0, kind: 'delete' },
      {
        id: 'fresh',
        sequence: 2,
        nodeId: 'fresh',
        baseRevision: 0,
        kind: 'create',
        node: { ...node, id: 'fresh' },
      },
      {
        id: 'stale-child',
        sequence: 3,
        nodeId: 'child0',
        baseRevision: 0,
        kind: 'create',
        node: { ...node, id: 'child0' },
      },
    ],
  });
  expect((await t.query(api.sync.snapshot, { deviceId })).nodes.map((n) => n.id)).toEqual([
    'fresh',
  ]);
  expect(await t.run((ctx) => ctx.db.query('retiredNodes').collect())).toHaveLength(2000);
});

it('bounds recent backups and expires old backups without deleting identity fences', async () => {
  const { t, deviceId } = await setup();
  for (let i = 0; i < 12; i++)
    await t.mutation(api.sync.backup, { deviceId, nodes: [node], reason: 'test' });
  expect(await t.run((ctx) => ctx.db.query('backups').collect())).toHaveLength(10);
  await t.mutation(api.sync.push, {
    deviceId,
    operations: [{ id: 'del', sequence: 1, nodeId: 'a', baseRevision: 1, kind: 'delete' }],
  });
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query('backups').collect())
      await ctx.db.patch(row._id, { at: Date.now() - 8 * 86400000 });
  });
  await t.mutation(internal.maintenance.expireRetention, {});
  expect(await t.run((ctx) => ctx.db.query('backups').collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query('retiredNodes').collect())).toHaveLength(1);
});

it('migrates existing tombstones on an empty push without changing live records', async () => {
  const { t, deviceId } = await setup();
  await t.run(async (ctx) => {
    const d = (await ctx.db.get(deviceId))!;
    await ctx.db.patch(d.collectionId, {
      nodes: [
        { ...node, deleted: true },
        { ...node, id: 'live' },
      ],
    });
  });
  await t.mutation(api.sync.push, { deviceId, operations: [] });
  expect((await t.query(api.sync.snapshot, { deviceId })).nodes.map((n) => n.id)).toEqual(['live']);
  expect(await t.run((ctx) => ctx.db.query('retiredNodes').collect())).toHaveLength(1);
});
