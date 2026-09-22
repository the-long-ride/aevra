import type { ControlNode, ControlObservation } from '../../protocol/src/control.js';

export interface ContextComposeRequest {
  maxNodes: number;
  interactiveOnly?: boolean;
}

function flatten(nodes: ControlNode[], output: ControlNode[] = []): ControlNode[] {
  for (const node of nodes) {
    output.push(node);
    if (node.children) flatten(node.children, output);
  }
  return output;
}

export class ContextComposer {
  compose(observation: ControlObservation, request: ContextComposeRequest): ControlObservation {
    const maxNodes = Math.max(1, Math.floor(request.maxNodes));
    const all = flatten(observation.nodes);
    const ranked = request.interactiveOnly
      ? all.filter((node) => node.actions.length > 0 || node.enabled)
      : all;
    const nodes = ranked.slice(0, maxNodes);
    const omitted = Math.max(0, ranked.length - nodes.length);
    return {
      ...structuredClone(observation),
      nodes: structuredClone(nodes),
      coverage: {
        ...observation.coverage,
        truncated: observation.coverage.truncated || omitted > 0,
        omittedNodes: observation.coverage.omittedNodes + omitted,
      },
    };
  }
}
