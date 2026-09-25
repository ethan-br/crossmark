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
    const rootSyncing: Record<string, boolean> = {};
    const available = roots.filter((n) => !n.unmodifiable && n.folderType !== 'managed');
    if (this.firefox) {
      for (const [key, id] of [
        ['toolbar', 'toolbar_____'],
        ['other', 'unfiled_____'],
        ['menu', 'menu________'],
      ]) {
        if (available.some((n) => n.id === id)) discovered[key] = id;
      }
    } else {
      const previousSyncing = { ...state.rootSyncing };
      if (state.rootSignature) {
        try {
          const signature: unknown = JSON.parse(state.rootSignature);
          if (Array.isArray(signature))
            for (const entry of signature)
              if (
                Array.isArray(entry) &&
                typeof entry[0] === 'string' &&
                typeof entry[2] === 'boolean'
              )
                for (const key of ['toolbar', 'other'])
                  if (state.roots[key] === entry[0] && previousSyncing[key] === undefined)
                    previousSyncing[key] = entry[2];
        } catch {
          // An old signature cannot prevent a safe metadata-based remap.
        }
      }
      for (const key of ['toolbar', 'other']) {
        const prior = available.find((n) => n.id === state.roots[key]);
        if (previousSyncing[key] === undefined && prior?.syncing !== undefined)
          previousSyncing[key] = prior.syncing;
      }
      const expectedSyncing = previousSyncing.toolbar ?? previousSyncing.other;
      if (
        previousSyncing.toolbar !== undefined &&
        previousSyncing.other !== undefined &&
        previousSyncing.toolbar !== previousSyncing.other
      )
        throw new Error('The bookmark toolbar and Other belong to different collections.');
      for (const [key, types] of [
        ['toolbar', ['bookmarks-bar', 'bookmarks_bar']],
        ['other', ['other']],
      ] as const) {
        const candidates = available.filter((n) =>
          (types as readonly string[]).includes(n.folderType ?? ''),
        );
        const prior = candidates.find((n) => n.id === state.roots[key]);
        const sameCollection = candidates.filter((n) => n.syncing === expectedSyncing);
        const preferred = candidates.filter((n) => n.syncing === true);
        const selected =
          prior ??
          (expectedSyncing !== undefined && sameCollection.length === 1
            ? sameCollection[0]
            : preferred.length === 1
              ? preferred[0]
              : candidates.length === 1
                ? candidates[0]
                : undefined);
        if (!selected && candidates.length)
          throw new Error('Multiple bookmark roots of the same type are ambiguous.');
        if (selected) {
          if (expectedSyncing !== undefined && selected.syncing !== expectedSyncing)
            throw new Error(
              'The selected bookmark collection is unavailable. Sync is paused to protect its contents.',
            );
          discovered[key] = selected.id;
          if (selected.syncing !== undefined) rootSyncing[key] = selected.syncing;
        }
      }
      if (
        rootSyncing.toolbar !== undefined &&
        rootSyncing.other !== undefined &&
        rootSyncing.toolbar !== rootSyncing.other
      )
        throw new Error('The bookmark toolbar and Other belong to different collections.');
      const other = available.find((n) => n.id === discovered.other);
      const menuFolders = (other?.children ?? []).filter(
        (n) => !n.url && !n.unmodifiable && n.title === 'Bookmarks Menu',
      );
      const mapped = (other?.children ?? []).find(
        (n) => n.id === state.roots.menu && !n.url && !n.unmodifiable,
      );
      const menu = mapped ?? (menuFolders.length === 1 ? menuFolders[0] : undefined);
      if (!menu && menuFolders.length > 1)
        throw new Error('Multiple Bookmarks Menu folders under Other are ambiguous.');
      if (menu) discovered.menu = menu.id;
      else if (state.roots.menu && (state.connected || state.registrationPending))
        throw new Error(
          'A mapped bookmark root was removed. Sync is paused to protect its contents.',
        );
    }
    if (!discovered.toolbar || !discovered.other || (this.firefox && !discovered.menu))
      throw new Error(
        'Your bookmark roots are unavailable. Reconnect after restoring your browser profile.',
      );
    // Keep an older mobile mapping only to avoid importing its wrapper as a normal folder.
    const oldMobile =
      !this.firefox &&
      roots
        .find((n) => n.id === discovered.other)
        ?.children?.find(
          (n) => n.id === state.roots.mobile && n.title === 'Mobile Bookmarks' && !n.url,
        )?.id;
    state.roots = discovered;
    if (oldMobile) state.roots.mobile = oldMobile;
    if (!this.firefox) state.rootSyncing = rootSyncing;
    delete state.rootSignature;
    const byNative = new Map(Object.entries(state.mappings).map(([id, native]) => [native, id]));
    const previous = new Map(state.baseline.map((n) => [n.id, n]));
    const result: Node[] = [];
    const visit = (native: NativeNode, parentId: string) => {
      if (native.unmodifiable) return;
      if (!this.firefox && native.id === discovered.menu) return;
      if (native.id === oldMobile) return;
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
    for (const [key, id] of Object.entries(discovered)) {
      const root =
        key === 'menu' && !this.firefox
          ? roots.find((n) => n.id === discovered.other)?.children?.find((n) => n.id === id)
          : roots.find((n) => n.id === id);
      for (const child of root?.children ?? []) visit(child, key);
    }
    return result;
  }
  async ensureRoots(state: State, store: Store, nodes: Node[]) {
    if (
      !this.firefox &&
      !state.roots.menu &&
      nodes.some((n) => !n.deleted && n.parentId === 'menu')
    ) {
      // Root creation uses the same crash journal as a regular folder.
      const target: Node = {
        id: 'menu',
        kind: 'folder',
        parentId: 'other',
        order: 999999,
        title: 'Bookmarks Menu',
        revision: 0,
      };
      await this.write(state, store, { kind: 'create', target });
      await store.write(state);
    }
  }
  projected(n: Node) {
    return n.parentId !== 'mobile' && (this.firefox || n.kind !== 'separator');
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
