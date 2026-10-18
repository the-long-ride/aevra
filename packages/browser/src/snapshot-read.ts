import type { SnapshotElementLike } from './dom-snapshot.js';

/**
 * A deliberately small selector subset - tag, #id, .class - matched against the
 * serialized tree. It exists so a scoped read returns one element rather than
 * the whole document; anything richer belongs in the page, not here.
 */
export function findBySelector(
  node: SnapshotElementLike,
  selector: string,
): SnapshotElementLike | null {
  const matches = (candidate: SnapshotElementLike): boolean => {
    if (selector.startsWith('#')) return candidate.attributes.id === selector.slice(1);
    if (selector.startsWith('.')) {
      return (candidate.attributes.class ?? '').split(/\s+/).includes(selector.slice(1));
    }
    return candidate.tagName.toLowerCase() === selector.toLowerCase();
  };
  if (matches(node)) return node;
  for (const child of node.children ?? []) {
    const found = findBySelector(child, selector);
    if (found) return found;
  }
  return null;
}

export function textOf(node: SnapshotElementLike): string {
  const own = String(node.textContent ?? '').trim();
  const children = (node.children ?? []).map(textOf).filter(Boolean);
  return [own, ...children].filter(Boolean).join('\n');
}
