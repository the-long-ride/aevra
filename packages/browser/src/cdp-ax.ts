import type { BrowserSnapshotNode } from '../../protocol/src/browser.js';
import { isCredentialField, makeRef, type SnapshotElementLike } from './dom-snapshot.js';

export interface AxNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string };
  backendDOMNodeId?: number;
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
}

export interface AxMapping {
  nodes: BrowserSnapshotNode[];
  backendIds: number[];
  truncated: boolean;
}

const INTERESTING_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'menuitem',
  'tab',
  'option',
  'heading',
  'listitem',
  'switch',
]);

/**
 * Reshapes a flat `DOM.getAttributes` list into the structural element the
 * credential guard understands, so one rule covers both transports.
 */
export function attributesToElement(attributes: string[]): SnapshotElementLike {
  const map: Record<string, string> = {};
  for (let index = 0; index + 1 < attributes.length; index += 2) {
    map[String(attributes[index])] = String(attributes[index + 1]);
  }
  return { tagName: 'input', attributes: map, children: [], textContent: '' };
}

export function axTreeToNodes(axNodes: AxNode[], version: number, maxNodes: number): AxMapping {
  const nodes: BrowserSnapshotNode[] = [];
  const backendIds: number[] = [];
  let truncated = false;
  for (const axNode of axNodes) {
    if (nodes.length >= maxNodes) {
      truncated = true;
      break;
    }
    if (axNode.ignored) continue;
    const role = String(axNode.role?.value ?? '');
    if (!INTERESTING_ROLES.has(role)) continue;
    if (axNode.backendDOMNodeId === undefined) continue;
    const node: BrowserSnapshotNode = {
      ref: makeRef(version, backendIds.length),
      role,
      name: String(axNode.name?.value ?? '').trim(),
    };
    const value = axNode.value?.value;
    if (value !== undefined) node.value = String(value);
    if (axNode.properties?.some((property) => property.name === 'disabled')) node.disabled = true;
    backendIds.push(axNode.backendDOMNodeId);
    nodes.push(node);
  }
  return { nodes, backendIds, truncated };
}

export function markCredentialFields(
  nodes: BrowserSnapshotNode[],
  attributesByIndex: Map<number, string[]>,
): void {
  for (const [index, attributes] of attributesByIndex) {
    const node = nodes[index];
    if (node && isCredentialField(attributesToElement(attributes))) node.credentialField = true;
  }
}
