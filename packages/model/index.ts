export const ROOTS = ['toolbar', 'other', 'menu', 'mobile'] as const;
export type Root = (typeof ROOTS)[number];
export type Kind = 'bookmark' | 'folder' | 'separator';
export interface Node {
  id: string;
  kind: Kind;
  parentId: string;
  order: number;
  title: string;
  url?: string;
  revision: number;
  deleted?: boolean;
}
export type Fields = Pick<Node, 'title' | 'url' | 'parentId' | 'order'>;
export interface Operation {
  id: string;
  sequence: number;
  nodeId: string;
  baseRevision: number;
  kind: 'create' | 'update' | 'delete' | 'restore';
  node?: Node;
  fields?: Partial<Fields>;
}
export interface Activity {
  id: string;
  nodeId: string;
  title: string;
  kind: Operation['kind'];
  device: string;
  at: number;
  conflict: boolean;
  before?: Node;
  after?: Node;
  attempted?: Node;
}
export interface Device {
  id: string;
  name: string;
  browser: string;
  lastSeen: number;
  cursor: number;
  revoked: boolean;
}
export interface Snapshot {
  nodes: Node[];
  revision: number;
  devices: Device[];
  activity: Activity[];
}
export const isRoot = (id: string): id is Root => (ROOTS as readonly string[]).includes(id);
export const alive = (nodes: Node[]) => nodes.filter((n) => !n.deleted);
// Legacy mobile subtrees stay in cloud snapshots but do not join or project.
export function portableNodes(nodes: Node[]): Node[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.filter((node) => {
    let parent = node.parentId;
    const seen = new Set<string>();
    while (byId.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      parent = byId.get(parent)!.parentId;
    }
    return parent !== 'mobile';
  });
}
export const count = (nodes: Node[]) => ({
  bookmarks: alive(nodes).filter((n) => n.kind === 'bookmark').length,
  folders: alive(nodes).filter((n) => n.kind === 'folder').length,
});
export const MAX_NODES = 2000;
export function validateTree(nodes: Node[]) {
  if (nodes.length > MAX_NODES || JSON.stringify(nodes).length > 600_000)
    throw new Error(
      'This v0 supports up to 2,000 records and 600 KB per collection, including recovery records.',
    );
  const map = new Map(nodes.map((n) => [n.id, n]));
  if (map.size !== nodes.length) throw new Error('Duplicate bookmark identity.');
  for (const n of nodes) {
    if (
      !/^[A-Za-z0-9_-]{1,100}$/.test(n.id) ||
      ['__proto__', 'constructor', 'prototype'].includes(n.id) ||
      isRoot(n.id) ||
      n.title.length > 1000 ||
      (n.url?.length ?? 0) > 8000 ||
      !Number.isFinite(n.order) ||
      n.order < 0 ||
      !Number.isInteger(n.revision) ||
      n.revision < 0
    )
      throw new Error('Invalid bookmark data.');
    if (n.kind === 'bookmark' && !n.url) throw new Error('A bookmark needs a URL.');
    if (n.deleted) continue;
    const seen = new Set([n.id]);
    let parent = n.parentId;
    while (!isRoot(parent)) {
      if (seen.has(parent)) throw new Error('A folder cannot contain itself.');
      seen.add(parent);
      const p = map.get(parent);
      if (!p || p.deleted || p.kind !== 'folder')
        throw new Error('Bookmark parent is unavailable.');
      parent = p.parentId;
    }
  }
}
