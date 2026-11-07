import { describe, expect, it } from 'vitest';
import { recoveryNodes, recoveryCopies } from '../apps/extension/src/recovery';
const node = {
  id: 'a',
  kind: 'bookmark',
  parentId: 'toolbar',
  title: 'Saved',
  url: 'https://example.com',
  order: 0,
  revision: 1,
};
describe('untrusted recovery exports', () => {
  it.each([
    [{ ...node, title: null }],
    [{ ...node, kind: 'unknown' }],
    [{ ...node, url: 'javascript:alert(1)' }],
    [{ ...node, order: -1 }],
    [node, node],
    [{ ...node, kind: 'folder', parentId: 'a' }],
    [{ ...node, deleted: 'false' }],
  ])('rejects invalid nodes %j', (...nodes) => {
    expect(() => recoveryNodes({ version: 1, nodes }, 'nodes')).toThrow();
  });
  it('selects a pre-join source and ignores tombstones and pending operations', () => {
    const nodes = recoveryNodes(
      {
        version: 1,
        joinRecovery: [node, { ...node, id: 'dead', deleted: true }],
        pending: [{ kind: 'delete' }],
      },
      'joinRecovery',
    );
    const copies = recoveryCopies(nodes, []);
    expect(copies).toHaveLength(2);
    expect(copies[1].parentId).toBe(copies[0].id);
    expect(copies[1].id).not.toBe(node.id);
  });
});
