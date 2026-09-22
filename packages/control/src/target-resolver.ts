import type {
  ControlAction,
  ControlNode,
  ControlObservation,
  ControlPredicate,
  ControlTarget,
} from '../../protocol/src/control.js';
import { ControlAdapterError } from './adapter.js';

function flatten(nodes: ControlNode[], output: ControlNode[] = []): ControlNode[] {
  for (const node of nodes) {
    output.push(node);
    if (node.children) flatten(node.children, output);
  }
  return output;
}

function nodeMap(observation: ControlObservation): Map<string, ControlNode> {
  return new Map(flatten(observation.nodes).map((node) => [node.ref, node]));
}

function isDescendant(
  candidate: ControlNode,
  ancestorRef: string,
  nodes: Map<string, ControlNode>,
): boolean {
  let current = candidate.parentRef;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === ancestorRef) return true;
    seen.add(current);
    current = nodes.get(current)?.parentRef;
  }
  return false;
}

export function resolveControlTarget(
  observation: ControlObservation,
  target: ControlTarget,
): ControlNode {
  const nodes = nodeMap(observation);
  if ('ref' in target) {
    const node = nodes.get(target.ref);
    if (!node) {
      throw new ControlAdapterError(
        'CONTROL_REF_STALE',
        `Ref ${target.ref} is not present in the current observation`,
        'notDispatched',
        'refresh',
      );
    }
    return node;
  }

  const locator = target.locator;
  const matches = [...nodes.values()].filter((node) => {
    if (node.role !== locator.role || node.name !== locator.name) return false;
    if (!locator.observedAncestor) return true;
    return (
      node.ref === locator.observedAncestor || isDescendant(node, locator.observedAncestor, nodes)
    );
  });

  if (matches.length === 0) {
    throw new ControlAdapterError(
      'CONTROL_TARGET_NOT_FOUND',
      `No ${locator.role} named ${JSON.stringify(locator.name)} exists in the observed scope`,
      'notDispatched',
      'refresh',
    );
  }
  if (matches.length !== 1) {
    throw new ControlAdapterError(
      'CONTROL_TARGET_AMBIGUOUS',
      `Expected one ${locator.role} named ${JSON.stringify(locator.name)}, found ${matches.length}`,
      'notDispatched',
      'needsContext',
    );
  }
  return matches[0]!;
}

function scopeNodes(
  observation: ControlObservation,
  predicate: Extract<ControlPredicate, { scope: 'surface' | 'subtree' }>,
  target?: ControlNode,
): ControlNode[] {
  const all = flatten(observation.nodes);
  if (predicate.scope === 'surface' || !target) return all;
  const byRef = nodeMap(observation);
  return all.filter((node) => node.ref === target.ref || isDescendant(node, target.ref, byRef));
}

export function evaluateControlPredicate(
  observation: ControlObservation,
  predicate: ControlPredicate,
  target?: ControlNode,
): boolean {
  switch (predicate.kind) {
    case 'enabled':
      return Boolean(target?.enabled) === predicate.equals;
    case 'valueEquals':
      return target?.value === predicate.value;
    case 'textPresent':
      return scopeNodes(observation, predicate, target).some(
        (node) => node.name.includes(predicate.text) || node.value?.includes(predicate.text),
      );
    case 'toggleStateEquals':
      return target?.toggleState === predicate.state;
    case 'elementAbsent':
      return !scopeNodes(observation, predicate, target).some(
        (node) =>
          (predicate.role === undefined || node.role === predicate.role) &&
          (predicate.name === undefined || node.name === predicate.name),
      );
    case 'urlEquals':
      return observation.url === predicate.url;
  }
}

export function supportsControlAction(node: ControlNode, action: ControlAction): boolean {
  if (action.op === 'click')
    return node.actions.includes('click') || node.actions.includes('invoke');
  if (action.op === 'type')
    return node.actions.includes('type') || node.actions.includes('setValue');
  if (action.op === 'setToggleState') return node.actions.includes('setToggleState');
  return node.actions.includes(action.op);
}
