import type {
  ControlDelta,
  ControlDeltaMetadata,
  ControlNode,
  ControlObservation,
  ControlObservationResult,
} from '../../protocol/src/control.js';
import { clone, projectNodes, stableSerialize } from './observation-rules.js';
import {
  ObservationStoreError,
  type NextId,
  type PendingChange,
  type PendingDelta,
  type SurfaceEntry,
} from './observation-types.js';

function deltaMetadata(
  latest: ControlObservation,
  baseline: ControlObservation,
): ControlDeltaMetadata {
  const imageChanged =
    stableSerialize(baseline.image ?? null) !== stableSerialize(latest.image ?? null);
  return {
    generation: latest.generation,
    policyRevision: latest.policyRevision,
    mode: latest.mode,
    observedAt: latest.observedAt,
    lastValidatedAt: latest.lastValidatedAt,
    ...(imageChanged ? { image: latest.image ? clone(latest.image) : null } : {}),
    imageChanged,
  };
}

function pendingBase(latest: ControlObservation, baseObservationId: string, pageSize: number) {
  return {
    pageSize,
    baseObservationId,
    observationId: latest.observationId,
    surfaceId: latest.surfaceId,
    revision: latest.revision,
    freshness: latest.freshness,
    watchHealth: latest.watchHealth,
    offset: 0,
    imageSent: false,
    coverage: latest.coverage,
  };
}

/** Node-level changes between a retained baseline and the latest observation. */
function diffChanges(baseline: ControlObservation, latest: ControlObservation): PendingChange[] {
  const before = new Map(projectNodes(baseline.nodes).map((node) => [node.ref, node]));
  const after = new Map(projectNodes(latest.nodes).map((node) => [node.ref, node]));
  const generationChanged = latest.generation !== baseline.generation;
  const changes: PendingChange[] = [];
  const remove = generationChanged
    ? [...before.keys()]
    : [...before.keys()].filter((ref) => !after.has(ref));
  for (const ref of remove) changes.push({ kind: 'remove', ref });

  for (const [ref, node] of after) {
    if (
      generationChanged ||
      !before.has(ref) ||
      stableSerialize(before.get(ref)) !== stableSerialize(node)
    ) {
      changes.push({ kind: 'upsert', node: clone(node) });
    }
  }
  return changes;
}

export function deltaPending(
  baseline: ControlObservation,
  latest: ControlObservation,
  baseObservationId: string,
  pageSize: number,
): PendingDelta {
  const changes = diffChanges(baseline, latest);
  return {
    kind: 'delta',
    ...pendingBase(latest, baseObservationId, pageSize),
    changes,
    metadata: deltaMetadata(latest, baseline),
  };
}

export function fullPending(
  latest: ControlObservation,
  baseObservationId: string,
  pageSize: number,
): PendingDelta {
  return {
    kind: 'full',
    ...pendingBase(latest, baseObservationId, pageSize),
    changes: [],
    fullNodes: projectNodes(latest.nodes).map((node) => clone(node)),
    fullObservation: clone(latest),
    metadata: deltaMetadata(latest, latest),
  };
}

/** Looks up a continuation and checks it still applies to this request. */
export function resumeContinuation(
  entry: SurfaceEntry,
  token: string,
  baseObservationId: string,
  latest: ControlObservation,
  maxNodes: number,
): PendingDelta {
  const pending = entry.continuations.get(token);
  if (
    !pending ||
    pending.baseObservationId !== baseObservationId ||
    pending.observationId !== latest.observationId
  ) {
    throw new ObservationStoreError(
      'CONTROL_DELTA_CONTINUATION_STALE',
      'Delta continuation no longer matches the current observation',
    );
  }
  if (pending.pageSize !== maxNodes) {
    throw new ObservationStoreError(
      'CONTROL_DELTA_CONTINUATION_MISMATCH',
      'Delta continuation must use its original page size',
    );
  }
  return pending;
}

function dropOtherContinuations(entry: SurfaceEntry, ...keep: string[]): void {
  for (const existingToken of entry.continuations.keys()) {
    if (!keep.includes(existingToken)) entry.continuations.delete(existingToken);
  }
}

function nextContinuation(
  entry: SurfaceEntry,
  token: string,
  pending: PendingDelta,
  nextOffset: number,
  nextId: NextId,
  totalChanges = pending.changes.length,
): ControlDelta['continuation'] {
  const nextToken =
    pending.nextToken ??
    (() => {
      const created = nextId(pending.kind === 'full' ? 'f' : 'c');
      pending.nextToken = created;
      entry.continuations.set(created, {
        ...pending,
        offset: nextOffset,
        nextToken: undefined,
        imageSent: true,
      });
      return created;
    })();
  dropOtherContinuations(entry, token, nextToken);
  return {
    token: nextToken,
    baseObservationId: pending.baseObservationId,
    observationId: pending.observationId,
    offset: nextOffset,
    totalChanges,
  };
}

function pageMetadata(pending: PendingDelta): ControlDeltaMetadata {
  if (pending.metadata.imageChanged && !pending.imageSent) return clone(pending.metadata);
  const { image: _image, ...withoutImage } = pending.metadata;
  return { ...withoutImage, imageChanged: false };
}

export function completeDelta(
  pending: PendingDelta,
  appliedObservationId: string,
  upsert: ControlNode[],
  remove: string[],
  continuation?: ControlDelta['continuation'],
  metadata: ControlDeltaMetadata = pending.metadata,
  omitted = pending.changes.length - pending.offset,
): ControlDelta {
  return {
    kind: 'delta',
    baseObservationId: pending.baseObservationId,
    observationId: pending.observationId,
    appliedObservationId,
    surfaceId: pending.surfaceId,
    revision: pending.revision,
    freshness: pending.freshness,
    watchHealth: pending.watchHealth,
    upsert,
    remove,
    complete: continuation === undefined,
    ...(continuation ? { continuation } : {}),
    metadata: clone(metadata),
    truncated: continuation !== undefined || pending.coverage.truncated,
    coverage: {
      ...pending.coverage,
      truncated: pending.coverage.truncated || continuation !== undefined,
      omittedNodes: pending.coverage.omittedNodes + Math.max(0, omitted),
    },
  };
}

export function emitFullPage(
  entry: SurfaceEntry,
  token: string,
  pending: PendingDelta,
  maxNodes: number,
  nextId: NextId,
): ControlObservationResult {
  const nodes = pending.fullNodes ?? [];
  const page = nodes.slice(pending.offset, pending.offset + maxNodes);
  const nextOffset = pending.offset + page.length;
  const complete = nextOffset >= nodes.length;
  const continuation = complete
    ? undefined
    : nextContinuation(entry, token, pending, nextOffset, nextId, nodes.length);
  if (complete) dropOtherContinuations(entry, token);
  const source = pending.fullObservation!;
  const { image: _image, ...sourceWithoutImage } = source;
  const observation = clone({
    ...(pending.imageSent ? sourceWithoutImage : source),
    nodes: page,
    coverage: {
      ...pending.coverage,
      truncated: pending.coverage.truncated || !complete,
      omittedNodes: pending.coverage.omittedNodes + Math.max(0, nodes.length - nextOffset),
    },
  });
  return {
    kind: 'full',
    observation,
    complete,
    ...(complete ? { appliedObservationId: pending.observationId } : {}),
    ...(continuation ? { continuation } : {}),
  };
}

export function emitDelta(
  entry: SurfaceEntry,
  token: string,
  pending: PendingDelta,
  maxNodes: number,
  nextId: NextId,
): ControlDelta {
  const page = pending.changes.slice(pending.offset, pending.offset + maxNodes);
  const nextOffset = pending.offset + page.length;
  const complete = nextOffset >= pending.changes.length;
  const upsert = page.flatMap((change) =>
    change.kind === 'upsert' && change.node ? [clone(change.node)] : [],
  );
  const remove = page.flatMap((change) =>
    change.kind === 'remove' && change.ref ? [change.ref] : [],
  );
  const continuation = complete
    ? undefined
    : nextContinuation(entry, token, pending, nextOffset, nextId);
  if (complete) dropOtherContinuations(entry, token);
  return completeDelta(
    pending,
    complete ? pending.observationId : pending.baseObservationId,
    upsert,
    remove,
    continuation,
    pageMetadata(pending),
    pending.changes.length - nextOffset,
  );
}
