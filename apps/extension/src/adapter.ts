import { debug } from './debug';
import type { Bookmarks } from 'webextension-polyfill';
import { type Node, isRoot } from '../../../packages/model';
import type { State, Store, Journal } from './state';
export interface NativeNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  type?: string;
  children?: NativeNode[];
  folderType?: string;
  syncing?: boolean;
  unmodifiable?: string;
}
export interface BookmarkAPI {
  getTree(): Promise<NativeNode[]>;
  getChildren(id: string): Promise<NativeNode[]>;
  get(id: string): Promise<NativeNode[]>;
  create(data: Bookmarks.CreateDetails): Promise<NativeNode>;
  update(id: string, data: Bookmarks.UpdateChangesType): Promise<NativeNode>;
  move(id: string, data: Bookmarks.MoveDestinationType): Promise<NativeNode>;
  remove(id: string): Promise<void>;
}
export class Adapter {
  constructor(
    readonly api: BookmarkAPI,
    readonly firefox: boolean,
  ) {}
  read(state: State): Promise<Node[]> {
    return debug.trace('bookmarks.read', () => this.readImpl(state));
  }
  private async readImpl(state: State): Promise<Node[]> {
    const tree = await this.api.getTree();
    const roots = tree[0]?.children ?? [];
    const discovered: Record<string, string> = {};
    for (const n of roots) {
      if (n.unmodifiable || n.folderType === 'managed') continue;
      let key: string | undefined;
      if (this.firefox)
        key = (
          {
            toolbar_____: 'toolbar',
            unfiled_____: 'other',
            menu________: 'menu',
            mobile______: 'mobile',
          } as Record<string, string>
        )[n.id];
      else
        key =
          (
            {
              'bookmarks-bar': 'toolbar',
              bookmarks_bar: 'toolbar',
              other: 'other',
              mobile: 'mobile',
            } as Record<string, string>
          )[n.folderType ?? ''] ??
          ({ '1': 'toolbar', '2': 'other', '3': 'mobile' } as Record<string, string>)[n.id];
      if (!key)
        throw new Error(
          'This browser exposes an unsupported bookmark root. Sync is paused to keep your bookmarks safe.',
        );
      if (discovered[key])
        throw new Error(
          'Multiple local and account bookmark roots detected. Choose one native bookmark collection before connecting this v0.',
        );
      discovered[key] = n.id;
    }
    if (!discovered.toolbar || !discovered.other)
      throw new Error(
        'Your bookmark roots are unavailable. Reconnect after restoring your browser profile.',
      );
    const signature = JSON.stringify(
      roots
        .filter((n) => !n.unmodifiable && n.folderType !== 'managed')
        .map((n) => [n.id, n.folderType, n.syncing])
        .sort(),
    );
    if (state.rootSignature && state.rootSignature !== signature)
      throw new Error(
        'Your native bookmark roots changed. Export your collection and reconnect this browser to review it safely.',
      );
    state.rootSignature = signature;
    // Synthetic menu/mobile folders have a durable mapping but are not canonical user nodes.
    const extra = Object.fromEntries(Object.entries(state.roots).filter(([k]) => !discovered[k]));
    const nativeIds = new Set<string>();
    const collect = (n: NativeNode) => {
      nativeIds.add(n.id);
      for (const child of n.children ?? []) collect(child);
    };
    for (const n of tree) collect(n);
    for (const [key, id] of Object.entries(extra))
      if (!nativeIds.has(id)) {
        if (!state.connected && !state.registrationPending) delete extra[key];
        else
          throw new Error(
            'A mapped bookmark root was removed. Reconnect this browser to review its collection safely.',
          );
      }
    state.roots = { ...extra, ...discovered };
    const byNative = new Map(Object.entries(state.mappings).map(([id, native]) => [native, id]));
    const previous = new Map(state.baseline.map((n) => [n.id, n]));
    const result: Node[] = [];
    const visit = (native: NativeNode, parentId: string) => {
      if (native.unmodifiable) return;
      const synthetic = Object.entries(state.roots).find(
        ([key, id]) => id === native.id && !discovered[key],
      );
      if (synthetic) {
        for (const child of native.children ?? []) visit(child, synthetic[0]);
        return;
      }
      let id = byNative.get(native.id);
      if (!id) {
        id = crypto.randomUUID();
        state.mappings[id] = native.id;
      }
      const kind = native.type === 'separator' ? 'separator' : native.url ? 'bookmark' : 'folder';
      result.push({
        id,
        kind,
        parentId,
        order: native.index ?? 0,
        title: native.title,
        ...(native.url ? { url: native.url } : {}),
        revision: previous.get(id)?.revision ?? 0,
      });
      for (const child of native.children ?? []) visit(child, id);
    };
    for (const [key, id] of Object.entries(discovered))
      for (const child of roots.find((n) => n.id === id)?.children ?? []) visit(child, key);
    return result;
  }
  async ensureRoots(state: State, store: Store, nodes: Node[]) {
    for (const key of ['menu', 'mobile'])
      if (!state.roots[key] && nodes.some((n) => !n.deleted && n.parentId === key)) {
        // Root creation uses the same crash journal as a regular folder.
        const target: Node = {
          id: key,
          kind: 'folder',
          parentId: 'other',
          order: 999999,
          title: key === 'menu' ? 'Bookmarks Menu' : 'Mobile Bookmarks',
          revision: 0,
        };
        await this.write(state, store, { kind: 'create', target });
        await store.write(state);
      }
  }
  projected(n: Node) {
    return this.firefox || n.kind !== 'separator';
  }
  recover(state: State, store: Store) {
    return debug.trace('bookmarks.recover', () => this.recoverImpl(state, store));
  }
  private async recoverImpl(state: State, store: Store) {
    const j = state.journal;
    if (!j) return;
    if (j.kind === 'create') {
      const parentId = state.roots[j.target.parentId] ?? state.mappings[j.target.parentId];
      const newChildren = (await this.api.getChildren(parentId)).filter(
        (n) => !j.childrenBefore?.includes(n.id),
      );
      const candidates = newChildren.filter(
        (n) =>
          !j.childrenBefore?.includes(n.id) &&
          n.title === j.target.title &&
          n.url === j.target.url &&
          (n.type === 'separator') === (j.target.kind === 'separator'),
      );
      if (candidates.length > 1 || (!candidates.length && newChildren.length))
        throw new Error(
          'An interrupted bookmark creation needs review. Export your collection before reconnecting.',
        );
      if (candidates.length === 1) {
        state.mappings[j.target.id] = candidates[0].id;
        j.target = { ...j.target, order: candidates[0].index ?? j.target.order };
        this.accept(state, j);
        await store.write(state);
        return;
      }
    }
    await this.execute(state, store, j);
  }
  private accept(state: State, j: Journal) {
    if (isRoot(j.target.id)) {
      if (j.kind === 'create') state.roots[j.target.id] = state.mappings[j.target.id];
      delete state.mappings[j.target.id];
    } else {
      const previous = state.baseline.find((n) => n.id === j.target.id);
      if (j.kind === 'delete' || j.kind === 'move')
        if (previous)
          for (const n of state.baseline)
            if (
              n.id !== previous.id &&
              n.parentId === previous.parentId &&
              n.order > previous.order
            )
              n.order--;
      if (j.kind === 'create' || j.kind === 'move')
        for (const n of state.baseline)
          if (n.id !== j.target.id && n.parentId === j.target.parentId && n.order >= j.target.order)
            n.order++;
      state.baseline = state.baseline.filter((n) => n.id !== j.target.id);
      if (j.kind !== 'delete') state.baseline.push(j.target);
    }
    if (j.kind === 'delete') delete state.mappings[j.target.id];
    delete state.journal;
  }
  write(state: State, store: Store, j: Journal) {
    return debug.trace('bookmarks.write', () => this.writeImpl(state, store, j));
  }
  private async writeImpl(state: State, store: Store, j: Journal) {
    if (j.kind === 'create')
      j.childrenBefore = (
        await this.api.getChildren(
          state.roots[j.target.parentId] ?? state.mappings[j.target.parentId],
        )
      ).map((n) => n.id);
    state.journal = j;
    await store.write(state);
    await this.execute(state, store, j);
  }
  private async execute(state: State, store: Store, j: Journal) {
    const n = j.target;
    const parentId = state.roots[n.parentId] ?? state.mappings[n.parentId];
    if (j.kind === 'create') {
      const details: Bookmarks.CreateDetails = {
        parentId,
        title: n.title,
        ...(n.url ? { url: n.url } : {}),
      };
      if (this.firefox && n.kind === 'separator') details.type = 'separator';
      const created = await this.api.create(details);
      state.mappings[n.id] = created.id;
      // Append first; ordering is reconciled separately using the actual index.
      j.target = { ...n, order: created.index ?? n.order };
    } else if (j.kind === 'delete') {
      let exists = true;
      try {
        await this.api.get(j.nativeId!);
      } catch {
        exists = false;
      }
      if (exists) await this.api.remove(j.nativeId!); // Never recursively delete a concurrent child.
    } else if (j.kind === 'update')
      await this.api.update(j.nativeId!, { title: n.title, ...(n.url ? { url: n.url } : {}) });
    else await this.api.move(j.nativeId!, { parentId, index: n.order });
    this.accept(state, j);
    await store.write(state);
  }
}
