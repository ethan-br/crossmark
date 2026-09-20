import { type Node, validateTree } from '../model';
import { parentFirst } from './index';

export interface JoinMatch {
  localId: string;
  nodeId: string;
}

// Joining is content reconciliation; ordinary sync continues to use identities.
// See docs/v0-decisions.md for the matching policy.
export function reconcileJoin(cloud: Node[], local: Node[]) {
  validateTree(local);
  const canonical = parentFirst(cloud);
  const additions: Node[] = [];
  const matches: JoinMatch[] = [];
  const aliases = new Map<string, string>();
  const used = new Set<string>();
  for (const node of parentFirst(local)) {
    const parentId = aliases.get(node.parentId) ?? node.parentId;
    const candidates = canonical.filter(
      (n) =>
        n.kind === node.kind &&
        (node.kind === 'bookmark'
          ? n.url === node.url
          : n.parentId === parentId &&
            (node.kind === 'folder' ? n.title === node.title : n.order === node.order)),
    );
    const available = candidates.filter((n) => !used.has(n.id));
    let match =
      available.find((n) => n.parentId === parentId && n.title === node.title) ??
      available.find((n) => n.parentId === parentId) ??
      available[0] ??
      candidates[0];
    if (!match) {
      match = {
        ...node,
        parentId,
        order:
          Math.max(-1, ...canonical.filter((n) => n.parentId === parentId).map((n) => n.order)) + 1,
        revision: 0,
      };
      canonical.push(match);
      additions.push(match);
    }
    used.add(match.id);
    aliases.set(node.id, match.id);
    matches.push({ localId: node.id, nodeId: match.id });
  }
  validateTree([...cloud, ...additions]);
  return { additions, matches };
}
