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
    await expect(
      unauthenticated.mutation(api.sync.push, { deviceId, operations: [] }),
    ).rejects.toThrow('Unauthenticated');
    const expired = await account('expired@example.com', Date.now() - 1000);
    await expect(expired.t.query(api.sync.snapshot, { deviceId })).rejects.toThrow(
      'Unauthenticated',
    );
    await t.mutation(api.sync.revoke, { deviceId, targetDeviceId: deviceId });
    await expect(t.query(api.sync.snapshot, { deviceId })).rejects.toThrow('disconnected');
    await expect(t.mutation(api.sync.push, { deviceId, operations: [] })).rejects.toThrow(
      'disconnected',
    );
  });
  it('isolates Google accounts on reads, writes and revocation', async () => {
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
      nodes: [{ ...node, id: 'local-only', url: 'https://local.example' }],
    });
    expect(second.joining).toBe(true);
    expect((await t.query(api.sync.snapshot, { deviceId: second.deviceId })).nodes).toEqual([
      { ...node, revision: 1, deleted: false },
    ]);
    await expect(
      t.mutation(api.sync.join, { deviceId: second.deviceId, nodes: [node] }),
    ).rejects.toThrow('Update Crossmark');
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
        fields: { title: 'Changed' },
      },
    ];
    await t.mutation(api.sync.push, { deviceId, operations });
    await t.mutation(api.sync.push, { deviceId, operations });
    const snapshot = await t.query(api.sync.snapshot, { deviceId });
    expect(snapshot.revision).toBe(2);
    expect(snapshot.activity).toHaveLength(1);
    expect(snapshot.nodes[0].title).toBe('Changed');
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
  expect(snapshot.activity[0].attempted?.title).toBe('Recover this offline title');
});
