import { describe, it, expect } from 'vitest';
import { activityKind, applyOperation, diff } from '../packages/sync-core';
import { type Node, type Operation, validateTree } from '../packages/model';
const bookmark = (id = 'a', overrides: Partial<Node> = {}): Node => ({
  id,
  kind: 'bookmark',
  title: 'Original',
  url: 'https://example.com/#exact?query=one',
  parentId: 'toolbar',
  order: 0,
  revision: 1,
  ...overrides,
});
const update = (fields: Operation['fields'], overrides: Partial<Operation> = {}): Operation => ({
  id: crypto.randomUUID(),
  sequence: 1,
  nodeId: 'a',
  kind: 'update',
  baseRevision: 1,
  fields,
  ...overrides,
});
describe('canonical synchronization', () => {
  it('merges independent fields and retains exact URLs', () => {
    const first = applyOperation([bookmark()], update({ title: 'Renamed' }), 2);
    const second = applyOperation(
      first.nodes,
      update({ url: 'https://example.com/#two?x=1&x=2' }),
      3,
    );
    expect(second.after).toMatchObject({
      title: 'Renamed',
      url: 'https://example.com/#two?x=1&x=2',
    });
    expect(second.before?.url).toBe(bookmark().url);
    expect(second.conflict).toBe(true);
  });
  it('keeps intentional duplicate URLs as distinct identities', () => {
    expect(diff([], [bookmark('a'), bookmark('b')], 0)).toHaveLength(2);
  });
  it('does not resurrect tombstones from delayed edits', () => {
    const deleted = applyOperation([bookmark()], update(undefined, { kind: 'delete' }), 2);
    const edited = applyOperation(deleted.nodes, update({ title: 'Offline edit' }), 3);
    expect(edited.after?.deleted).toBe(true);
  });
  it('restores only with an explicit operation', () => {
    const result = applyOperation(
      [bookmark('a', { deleted: true })],
      update(undefined, { kind: 'restore', node: bookmark('a', { title: 'Recovered' }) }),
      3,
    );
    expect(result.after).toMatchObject({ deleted: false, title: 'Recovered' });
  });
  it('recovers late child additions under a deleted folder to Other', () => {
    const folder: Node = {
      id: 'f',
      kind: 'folder',
      title: 'Folder',
      parentId: 'toolbar',
      order: 0,
      revision: 2,
      deleted: true,
    };
    const result = applyOperation(
      [folder],
      {
        id: 'op',
        sequence: 1,
        nodeId: 'a',
        baseRevision: 0,
        kind: 'create',
        node: bookmark('a', { parentId: 'f' }),
      },
      3,
    );
    expect(result.after?.parentId).toBe('other');
    expect(result.conflict).toBe(true);
  });
  it('deletes a complete folder subtree', () => {
    const nodes = [
      bookmark('f', { kind: 'folder', url: undefined }),
      bookmark('a', { parentId: 'f' }),
    ];
    const result = applyOperation(nodes, update(undefined, { kind: 'delete', nodeId: 'f' }), 2);
    expect(result.nodes.every((n) => n.deleted)).toBe(true);
  });
  it('breaks concurrent cyclic moves into Other', () => {
    const nodes = [
      bookmark('f', { kind: 'folder', url: undefined }),
      bookmark('g', { kind: 'folder', url: undefined, parentId: 'f' }),
    ];
    const result = applyOperation(nodes, update({ parentId: 'g' }, { nodeId: 'f' }), 2);
    expect(result.after?.parentId).toBe('other');
    expect(result.conflict).toBe(true);
  });
  it('maps only structural changes to activity', () => {
    const folder = bookmark('f', { kind: 'folder', url: undefined });
    const separator = bookmark('s', { kind: 'separator', url: undefined, title: '' });
    expect(activityKind('create', undefined, bookmark())).toBe('added');
    expect(activityKind('create', bookmark(), bookmark())).toBeUndefined();
    expect(activityKind('create', undefined, separator)).toBeUndefined();
    expect(activityKind('delete', folder, { ...folder, deleted: true })).toBe('removed');
    expect(
      activityKind('delete', { ...folder, deleted: true }, { ...folder, deleted: true }),
    ).toBeUndefined();
    expect(activityKind('update', bookmark(), bookmark('a', { parentId: 'f' }))).toBe('moved');
    expect(activityKind('update', bookmark(), bookmark('a', { order: 4 }))).toBeUndefined();
    expect(activityKind('update', bookmark(), bookmark('a', { title: 'New' }))).toBeUndefined();
    expect(
      activityKind('update', bookmark('a', { deleted: true }), bookmark('a', { deleted: true })),
    ).toBeUndefined();
    expect(activityKind('restore', bookmark('a', { deleted: true }), bookmark())).toBeUndefined();
  });
  it('makes no operations for an unchanged tree', () => {
    expect(diff([bookmark()], [bookmark()], 42)).toEqual([]);
  });
  it('rejects duplicate IDs and overlong payloads', () => {
    expect(() => validateTree([bookmark(), bookmark()])).toThrow('Duplicate');
    expect(() => validateTree([bookmark('a', { title: 'x'.repeat(1001) })])).toThrow('Invalid');
  });
});
