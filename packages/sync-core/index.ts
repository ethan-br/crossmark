import {
  isRoot,
  validateTree,
  type ActivityKind,
  type Node,
  type Operation,
  type Fields,
} from '../model';
const keys = ['title', 'url', 'parentId', 'order'] as const;
export function diff(
  before: Node[],
  after: Node[],
  startSequence: number,
  uuid = () => crypto.randomUUID(),
): Operation[] {
  const old = new Map(before.filter((n) => !n.deleted).map((n) => [n.id, n]));
  const current = new Map(after.filter((n) => !n.deleted).map((n) => [n.id, n]));
  const ops: Operation[] = [];
  const add = (op: Omit<Operation, 'id' | 'sequence'>) =>
    ops.push({ ...op, id: uuid(), sequence: startSequence + ops.length + 1 });
  for (const n of current.values()) {
    const prev = old.get(n.id);
    if (!prev) add({ kind: 'create', nodeId: n.id, baseRevision: 0, node: n });
    else {
      const fields: Partial<Fields> = {};
      for (const key of keys) if (n[key] !== prev[key]) Object.assign(fields, { [key]: n[key] });
      if (Object.keys(fields).length)
        add({ kind: 'update', nodeId: n.id, baseRevision: prev.revision, fields });
    }
  }
  for (const n of old.values())
    if (!current.has(n.id)) add({ kind: 'delete', nodeId: n.id, baseRevision: n.revision });
  return ops;
}
export function applyOperation(
  nodes: Node[],
  op: Operation,
  revision: number,
): { nodes: Node[]; before?: Node; after?: Node; conflict: boolean } {
  const map = new Map(nodes.map((n) => [n.id, { ...n }]));
  const before = map.get(op.nodeId);
  let conflict = !!before && before.revision > op.baseRevision;
  if (op.kind === 'create') {
    if (!op.node || op.node.id !== op.nodeId || isRoot(op.nodeId))
      throw new Error('Invalid create operation.');
    if (before) return { nodes, before, after: before, conflict: true };
    map.set(op.nodeId, { ...op.node, revision, deleted: false });
  } else if (op.kind === 'restore') {
    if (!op.node || op.node.id !== op.nodeId) throw new Error('Invalid restore operation.');
    map.set(op.nodeId, { ...op.node, revision, deleted: false });
  } else if (!before) throw new Error('Unknown bookmark.');
  else if (op.kind === 'delete') {
    const removed = new Set([op.nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of map.values())
        if (!removed.has(n.id) && removed.has(n.parentId)) {
          removed.add(n.id);
          changed = true;
        }
    }
    for (const id of removed) map.set(id, { ...map.get(id)!, deleted: true, revision });
  } else if (!before.deleted) map.set(op.nodeId, { ...before, ...op.fields, revision });
  // Tombstones win against stale edits. Only an explicit restore can revive them.
  let after = map.get(op.nodeId);
  if (after && !after.deleted && !isRoot(after.parentId)) {
    const parent = map.get(after.parentId);
    if (!parent || parent.deleted) {
      after = { ...after, parentId: 'other' };
      map.set(after.id, after);
      conflict = true;
    }
  }
  // Concurrent moves can each be valid locally but form a cycle when combined.
  // Break the incoming edge deterministically instead of blocking the durable queue.
  if (after && !after.deleted) {
    const visited = new Set([after.id]);
    let parent = after.parentId;
    while (!isRoot(parent)) {
      if (visited.has(parent)) {
        after = { ...after, parentId: 'other' };
        map.set(after.id, after);
        conflict = true;
        break;
      }
      visited.add(parent);
      const ancestor = map.get(parent);
      if (!ancestor) break;
      parent = ancestor.parentId;
    }
  }
  const result = [...map.values()];
  validateTree(result);
  return { nodes: result, before, after, conflict };
}
// Title/URL edits, reorders within a folder, stale edits to tombstones and
// no-op creates are not structural changes and produce no activity.
export function activityKind(
  kind: string,
  before?: Node,
  after?: Node,
): Exclude<ActivityKind, 'synced'> | undefined {
  const node = after ?? before;
  if (!node || node.kind === 'separator') return;
  if (kind === 'create') return before ? undefined : 'added';
  if (!before || before.deleted) return;
  if (kind === 'delete') return 'removed';
  if (kind === 'update' && after && !after.deleted && after.parentId !== before.parentId)
    return 'moved';
}
export function sameNative(a: Node, b: Node) {
  return a.kind === b.kind && keys.every((k) => a[k] === b[k]);
}
export function parentFirst(nodes: Node[]): Node[] {
  const result: Node[] = [];
  const todo = new Map(nodes.filter((n) => !n.deleted).map((n) => [n.id, n]));
  while (todo.size) {
    let progressed = false;
    for (const [id, n] of [...todo].sort(
      ([, a], [, b]) => a.order - b.order || a.id.localeCompare(b.id),
    ))
      if (!todo.has(n.parentId)) {
        result.push(n);
        todo.delete(id);
        progressed = true;
      }
    if (!progressed) throw new Error('Invalid folder hierarchy.');
  }
  return result;
}
