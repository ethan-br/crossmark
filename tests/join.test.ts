import { describe, expect, it } from 'vitest';
import type { Node } from '../packages/model';
import { reconcileJoin } from '../packages/sync-core/join';

const bookmark = (id: string, overrides: Partial<Node> = {}): Node => ({
  id,
  kind: 'bookmark',
  parentId: 'toolbar',
  title: id,
  url: 'https://example.com/',
  order: 0,
  revision: 1,
  ...overrides,
});
const folder = (id: string, overrides: Partial<Node> = {}): Node => ({
  id,
  kind: 'folder',
  parentId: 'toolbar',
  title: 'Work',
  order: 0,
  revision: 1,
  ...overrides,
});

describe('joining content matching', () => {
  it('matches exact URLs globally, preserving cloud titles, folders and existing duplicates', () => {
    const cloud = [
      folder('cloud-folder'),
      bookmark('a', { parentId: 'cloud-folder' }),
      bookmark('b'),
    ];
    const before = structuredClone(cloud);
    const result = reconcileJoin(cloud, [bookmark('x'), bookmark('y'), bookmark('z')]);
    expect(result.additions).toEqual([]);
    expect(new Set(result.matches.map((m) => m.nodeId))).toEqual(new Set(['a', 'b']));
    expect(cloud).toEqual(before);
  });

  it('keeps distinct URL strings, ignoring titles when deciding whether a URL is new', () => {
    const urls = [
      'http://example.com/',
      'https://example.com',
      'https://example.com/?x=1',
      'https://example.com/#a',
      'https://EXAMPLE.com/',
      'https://example.com/path',
    ];
    const result = reconcileJoin(
      [bookmark('cloud')],
      urls.map((url, i) => bookmark(`local${i}`, { url, title: 'Same title' })),
    );
    expect(result.additions.map((n) => n.url)).toEqual(urls);
  });

  it('matches folder paths exactly and appends new children without reordering cloud nodes', () => {
    const cloud = [
      folder('f'),
      folder('nested', { parentId: 'f', title: 'Nested' }),
      bookmark('cloud', { parentId: 'nested', order: 8 }),
    ];
    const result = reconcileJoin(cloud, [
      folder('local-f'),
      folder('local-nested', { parentId: 'local-f', title: 'Nested' }),
      bookmark('new', { parentId: 'local-nested', url: 'https://new.example' }),
      folder('different-root', { parentId: 'other' }),
      folder('different-case', { title: 'work' }),
    ]);
    expect(result.matches).toContainEqual({ localId: 'local-f', nodeId: 'f' });
    expect(result.matches).toContainEqual({ localId: 'local-nested', nodeId: 'nested' });
    expect(result.additions).toContainEqual(
      expect.objectContaining({ id: 'new', parentId: 'nested', order: 9 }),
    );
    expect(result.additions.filter((n) => n.kind === 'folder')).toHaveLength(2);
  });

  it('collapses repeated new URLs and folder paths within the joining browser', () => {
    const result = reconcileJoin(
      [],
      [
        folder('f1'),
        folder('f2'),
        bookmark('a', { parentId: 'f1' }),
        bookmark('b', { parentId: 'f2' }),
      ],
    );
    expect(result.additions).toHaveLength(2);
    expect(reconcileJoin(result.additions, result.additions).additions).toEqual([]);
  });

  it('does not reuse tombstones and matches separators by parent and position', () => {
    const separator: Node = {
      id: 's',
      kind: 'separator',
      title: '',
      parentId: 'toolbar',
      order: 2,
      revision: 1,
    };
    const result = reconcileJoin(
      [bookmark('deleted', { deleted: true }), separator],
      [bookmark('new'), { ...separator, id: 'local-s' }, { ...separator, id: 'new-s', order: 3 }],
    );
    expect(result.additions.map((n) => n.id)).toEqual(['new', 'new-s']);
    expect(result.matches).toContainEqual({ localId: 'local-s', nodeId: 's' });
  });
});
