import type { Bookmarks } from 'webextension-polyfill';
import type { NativeNode, BookmarkAPI } from '../../apps/extension/src/adapter';
export class MemoryBookmarks implements BookmarkAPI {
  nodes: NativeNode[];
  constructor(
    nodes?: NativeNode[],
    readonly persist?: (nodes: NativeNode[]) => void,
  ) {
    this.nodes = nodes ?? [
      { id: '1', title: 'Bookmarks Bar' },
      { id: '2', title: 'Other Bookmarks' },
    ];
  }
  private save() {
    this.persist?.(this.nodes);
  }
  async getTree() {
    const build = (n: NativeNode): NativeNode => ({
      ...n,
      ...(!n.url && n.type !== 'separator'
        ? {
            children: this.nodes
              .filter((x) => x.parentId === n.id)
              .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
              .map(build),
          }
        : {}),
    });
    return [{ id: '0', title: '', children: this.nodes.filter((n) => !n.parentId).map(build) }];
  }
  async getChildren(id: string) {
    return structuredClone(
      this.nodes.filter((n) => n.parentId === id).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)),
    );
  }
  async get(id: string) {
    const n = this.nodes.find((n) => n.id === id);
    if (!n) throw new Error('Bookmark not found');
    return [structuredClone(n)];
  }
  async create(data: Bookmarks.CreateDetails) {
    const siblings = this.nodes.filter((n) => n.parentId === data.parentId);
    const index = Math.min(data.index ?? siblings.length, siblings.length);
    for (const n of siblings) if (n.index! >= index) n.index!++;
    const n: NativeNode = {
      id: crypto.randomUUID(),
      title: data.title ?? '',
      parentId: data.parentId,
      index,
      ...(data.url ? { url: data.url } : {}),
      ...(data.type ? { type: data.type } : {}),
    };
    this.nodes.push(n);
    this.save();
    return structuredClone(n);
  }
  async update(id: string, data: Bookmarks.UpdateChangesType) {
    const n = this.nodes.find((n) => n.id === id)!;
    Object.assign(n, data);
    this.save();
    return structuredClone(n);
  }
  async move(id: string, data: Bookmarks.MoveDestinationType) {
    const n = this.nodes.find((n) => n.id === id)!;
    for (const other of this.nodes)
      if (other.parentId === n.parentId && other.index! > n.index!) other.index!--;
    const parentId = data.parentId ?? n.parentId;
    const index = Math.min(
      data.index ?? 99999,
      this.nodes.filter((x) => x.id !== id && x.parentId === parentId).length,
    );
    for (const other of this.nodes)
      if (other.id !== id && other.parentId === parentId && other.index! >= index) other.index!++;
    Object.assign(n, { parentId, index });
    this.save();
    return structuredClone(n);
  }
  async remove(id: string) {
    if (this.nodes.some((n) => n.parentId === id)) throw new Error('Folder is not empty');
    const n = this.nodes.find((n) => n.id === id)!;
    this.nodes = this.nodes.filter((n) => n.id !== id);
    for (const other of this.nodes)
      if (other.parentId === n.parentId && other.index! > n.index!) other.index!--;
    this.save();
  }
}
