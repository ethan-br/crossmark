import { isRoot, validateTree, type Node } from '../../../packages/model';
import { parentFirst } from '../../../packages/sync-core';

export type RecoverySource = 'nodes' | 'localRecovery' | 'joinRecovery';
export const recoverySources: RecoverySource[] = ['nodes', 'localRecovery', 'joinRecovery'];
export const MAX_EXPORT_BYTES = 8_000_000;

/** Treat files and runtime messages as untrusted, including their runtime field types. */
export function recoveryNodes(data: unknown, source: RecoverySource): Node[] {
  if (!recoverySources.includes(source)) throw new Error('Choose a recovery source.');
  if (!data || typeof data !== 'object' || (data as { version?: unknown }).version !== 1)
    throw new Error('Choose a Crossmark version 1 JSON export.');
  const raw = (data as Record<string, unknown>)[source];
  if (!Array.isArray(raw)) throw new Error('This export does not contain that recovery source.');
  const nodes: Node[] = raw.map((n: unknown) => {
    if (!n || typeof n !== 'object') throw new Error('Invalid bookmark data.');
    const v = n as Record<string, unknown>;
    if (
      typeof v.id !== 'string' ||
      typeof v.parentId !== 'string' ||
      typeof v.title !== 'string' ||
      !['bookmark', 'folder', 'separator'].includes(String(v.kind)) ||
      typeof v.order !== 'number' ||
      typeof v.revision !== 'number' ||
      (v.url !== undefined && typeof v.url !== 'string') ||
      (v.deleted !== undefined && typeof v.deleted !== 'boolean')
    )
      throw new Error('Invalid bookmark data.');
    if (v.kind === 'bookmark' && !/^(https?|ftp|file):/i.test(v.url as string))
      throw new Error('Recovery supports only http, https, ftp and file bookmark URLs.');
    return {
      id: v.id,
      parentId: v.parentId,
      title: v.title,
      kind: v.kind as Node['kind'],
      order: v.order,
      revision: v.revision,
      ...(v.url !== undefined ? { url: v.url as string } : {}),
      ...(v.deleted !== undefined ? { deleted: v.deleted as boolean } : {}),
    };
  });
  validateTree(nodes);
  return parentFirst(nodes.filter((n) => !n.deleted));
}

export function recoveryCopies(nodes: Node[], current: Node[]): Node[] {
  if (!nodes.length) throw new Error('This recovery source has no live bookmarks or folders.');
  const folderId = crypto.randomUUID();
  const ids = new Map(nodes.map((n) => [n.id, crypto.randomUUID()]));
  return [
    {
      id: folderId,
      kind: 'folder',
      parentId: 'other',
      order:
        Math.max(
          -1,
          ...current.filter((n) => !n.deleted && n.parentId === 'other').map((n) => n.order),
        ) + 1,
      title: 'Recovered bookmarks',
      revision: 0,
    },
    ...nodes.map((n) => ({
      ...n,
      id: ids.get(n.id)!,
      parentId: isRoot(n.parentId) ? folderId : ids.get(n.parentId)!,
      revision: 0,
    })),
  ];
}
