import type { ControlObservation } from '../../protocol/src/control.js';

export function observation(
  observationId: string,
  revision: number,
  nodes: ControlObservation['nodes'],
  options: Partial<
    Pick<ControlObservation, 'surfaceId' | 'generation' | 'policyRevision' | 'mode' | 'image'>
  > = {},
): ControlObservation {
  return {
    observationId,
    surfaceId: options.surfaceId ?? 'surface_settings',
    generation: options.generation ?? 1,
    revision,
    freshness: 'fresh',
    watchHealth: 'healthy',
    observedAt: `2026-09-22T09:00:0${revision}Z`,
    lastValidatedAt: `2026-09-22T09:00:0${revision}Z`,
    policyRevision: options.policyRevision ?? 1,
    mode: options.mode ?? 'sharedSemantic',
    coverage: { scope: 'surface', truncated: false, omittedNodes: 0 },
    nodes,
    ...(options.image === undefined ? {} : { image: options.image }),
  };
}
