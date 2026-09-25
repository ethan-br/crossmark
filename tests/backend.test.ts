import { authenticatedBackend } from './fixtures/auth';
import { describe, it, expect } from 'vitest';
import { api } from '../convex/_generated/api';
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
    await expect(unauthenticated.query(api.sync.snapshot, { deviceId })).rejects.toThrow(
      'Unauthenticated',
    );
    await expect(unauthenticated.mutation(api.sync.join, { deviceId, nodes: [] })).rejects.toThrow(
      'Unauthenticated',
    );
    const expired = await account('expired@example.com', Date.now() - 1000);
    await expect(expired.t.query(api.sync.snapshot, { deviceId })).rejects.toThrow(
      'Unauthenticated',
    );
    await t.mutation(api.sync.revoke, { deviceId, targetDeviceId: deviceId });
    await expect(t.query(api.sync.snapshot, { deviceId })).rejects.toThrow('disconnected');
    await expect(t.mutation(api.sync.join, { deviceId, nodes: [] })).rejects.toThrow(
      'disconnected',
    );
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
    await expect(
      t.mutation(api.sync.push, { deviceId: second.deviceId, operations: [] }),
    ).rejects.toThrow('disconnected');
    await expect(
      t.mutation(api.sync.join, { deviceId: second.deviceId, nodes: [] }),
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
  expect(snapshot.nodes[0].deleted).toBe(true);
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
  expect(snapshot.activity[0]).toMatchObject({ kind: 'synced', title: 'First' });
  expect(Object.keys(snapshot.activity[0]).sort()).toEqual(['at', 'id', 'kind', 'title']);
  const synced = snapshot.activity[0].at;
  await t.mutation(api.sync.checkpoint, { deviceId, cursor: snapshot.revision });
  snapshot = await t.query(api.sync.snapshot, { deviceId });
  expect(snapshot.activity.filter((a) => a.kind === 'synced')).toEqual([
    expect.objectContaining({ at: synced }),
  ]);
});
