import type { ControlNode, ControlObservation } from '../../protocol/src/control.js';
import {
  ObservationStoreError,
  type ObservationRecordOptions,
  type ObservationStoreLimits,
  type SurfaceEntry,
} from './observation-types.js';

const MAX_DIRTY_REASONS = 16;
const MAX_DIRTY_REASON_LENGTH = 256;

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function projectedNode(node: ControlNode, parentRef?: string): ControlNode {
  const { children: _children, ...ownFields } = node;
  const childRefs = node.children?.map((child) => child.ref) ?? node.childRefs;
  return {
    ...ownFields,
    ...(parentRef === undefined && node.parentRef === undefined
      ? {}
      : { parentRef: node.parentRef ?? parentRef }),
    ...(childRefs && childRefs.length > 0 ? { childRefs } : {}),
  };
}

/** Flattens a node tree into parent/child ref form, depth first. */
export function projectNodes(
  nodes: ControlNode[],
  output: ControlNode[] = [],
  parentRef?: string,
): ControlNode[] {
  for (const node of nodes) {
    output.push(projectedNode(node, parentRef));
    if (node.children) projectNodes(node.children, output, node.ref);
  }
  return output;
}

export function current(entry: SurfaceEntry): ControlObservation {
  const observation = entry.history[0];
  if (!observation) {
    throw new ObservationStoreError('CONTROL_SURFACE_NOT_FOUND', 'Observation is not recorded');
  }
  return observation;
}

export function validateObservation(
  observation: ControlObservation,
  limits: ObservationStoreLimits,
): void {
  const nodes = projectNodes(observation.nodes);
  if (nodes.length > limits.maxNodesPerSurface) {
    throw new ObservationStoreError(
      'CONTROL_OBSERVATION_TOO_LARGE',
      `surface ${observation.surfaceId} contains ${nodes.length} nodes; limit is ${limits.maxNodesPerSurface}`,
    );
  }
  if (new Set(nodes.map((node) => node.ref)).size !== nodes.length) {
    throw new ObservationStoreError(
      'CONTROL_DUPLICATE_REF',
      'Observation contains duplicate node refs',
    );
  }
  if (observation.image && byteLength(observation.image.dataUri) > limits.maxImageBytes) {
    throw new ObservationStoreError(
      'CONTROL_IMAGE_TOO_LARGE',
      'Observation image exceeds the configured limit',
    );
  }
  if (byteLength(observation) > limits.maxBytesPerObservation) {
    throw new ObservationStoreError(
      'CONTROL_OBSERVATION_TOO_LARGE',
      'Observation exceeds the configured byte limit',
    );
  }
}

/** Refuses writes that would replace the current observation with an older view. */
export function rejectStaleWrite(
  entry: SurfaceEntry,
  observation: ControlObservation,
  options: ObservationRecordOptions,
): void {
  const latest = current(entry);
  if (entry.eventEpoch > 0 && options.validationEpoch !== entry.eventEpoch) {
    throw new ObservationStoreError(
      'CONTROL_OBSERVATION_STALE',
      'Observation was validated against an older event epoch',
    );
  }
  const historical = entry.history.find(
    (candidate) => candidate.observationId === observation.observationId,
  );
  if (historical && historical.observationId !== latest.observationId) {
    throw new ObservationStoreError(
      'CONTROL_OBSERVATION_STALE',
      'Observation ID already identifies a retained baseline',
    );
  }
  if (
    latest.observationId === observation.observationId &&
    stableSerialize(latest) !== stableSerialize(observation)
  ) {
    throw new ObservationStoreError(
      'CONTROL_OBSERVATION_IMMUTABLE',
      'Observation IDs are immutable',
    );
  }
  if (observation.generation < latest.generation) {
    throw new ObservationStoreError('CONTROL_OBSERVATION_STALE', 'Observation generation is stale');
  }
  if (observation.generation === latest.generation && observation.revision < latest.revision) {
    throw new ObservationStoreError('CONTROL_OBSERVATION_STALE', 'Observation revision is stale');
  }
  if (
    observation.generation === latest.generation &&
    observation.revision === latest.revision &&
    observation.observationId !== latest.observationId &&
    (entry.eventEpoch === 0 ||
      options.validationEpoch !== entry.eventEpoch ||
      observation.freshness !== 'fresh')
  ) {
    throw new ObservationStoreError(
      'CONTROL_OBSERVATION_STALE',
      'Observation revision is not newer',
    );
  }
  if (observation.policyRevision < latest.policyRevision) {
    throw new ObservationStoreError(
      'CONTROL_OBSERVATION_STALE',
      'Observation policy revision is stale',
    );
  }
}

function trimHistoryImages(history: ControlObservation[], maxImages: number): ControlObservation[] {
  let images = 0;
  return history.map((observation) => {
    if (!observation.image) return observation;
    images += 1;
    return images <= maxImages
      ? observation
      : (() => {
          const { image: _image, ...withoutImage } = observation;
          return withoutImage;
        })();
  });
}

function trimHistoryToBudget(
  history: ControlObservation[],
  maxBytes: number,
): ControlObservation[] {
  const retained = [...history];
  while (retained.length > 1 && byteLength(retained) > maxBytes) {
    retained.pop();
  }
  if (byteLength(retained) > maxBytes) {
    throw new ObservationStoreError(
      'CONTROL_CACHE_BYTES_EXCEEDED',
      'Current observation exceeds the history byte limit',
    );
  }
  return retained;
}

/** Drops surplus screenshots, then the oldest baselines, until history fits its budget. */
export function trimHistory(
  history: ControlObservation[],
  limits: ObservationStoreLimits,
): ControlObservation[] {
  return trimHistoryToBudget(
    trimHistoryImages(history, limits.maxImagesPerSurface),
    limits.maxBytesPerHistory,
  );
}

export function rememberDirtyReason(entry: SurfaceEntry, reason: string): void {
  const bounded = reason.slice(0, MAX_DIRTY_REASON_LENGTH);
  entry.dirtyReasons.delete(bounded);
  entry.dirtyReasons.add(bounded);
  while (entry.dirtyReasons.size > MAX_DIRTY_REASONS) {
    const oldest = entry.dirtyReasons.values().next().value as string | undefined;
    if (oldest === undefined) break;
    entry.dirtyReasons.delete(oldest);
  }
}

/** Advances the event epoch unless this exact event key was already applied. */
export function advanceEvent(entry: SurfaceEntry, eventKey?: string): boolean {
  if (eventKey !== undefined && entry.lastEventKey === eventKey) return false;
  entry.eventEpoch += 1;
  entry.lastEventKey = eventKey;
  return true;
}
