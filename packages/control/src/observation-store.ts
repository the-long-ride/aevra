import type { ControlObservation, ControlObservationResult } from '../../protocol/src/control.js';
import {
  completeDelta,
  deltaPending,
  emitDelta,
  emitFullPage,
  fullPending,
  resumeContinuation,
} from './observation-paging.js';
import {
  advanceEvent,
  byteLength,
  clone,
  current,
  rejectStaleWrite,
  rememberDirtyReason,
  trimHistory,
  validateObservation,
} from './observation-rules.js';
import {
  DEFAULT_LIMITS,
  ObservationStoreError,
  type ObservationDeltaBudget,
  type ObservationRecordOptions,
  type ObservationStoreLimits,
  type ObservationStoreOptions,
  type PendingDelta,
  type SurfaceEntry,
} from './observation-types.js';
import { SurfaceRegistry } from './surface-registry.js';

export {
  type ObservationDeltaBudget,
  type ObservationRecordOptions,
  type ObservationStoreLimits,
  type ObservationStoreOptions,
} from './observation-types.js';

export class ObservationStore {
  private readonly limits: ObservationStoreLimits;
  private readonly surfaces: SurfaceRegistry;
  private readonly nextIdFn = (prefix: string) => this.nextId(prefix);
  private idSequence = 0;

  constructor(limits: Partial<ObservationStoreLimits> = {}, options: ObservationStoreOptions = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.surfaces = new SurfaceRegistry(this.limits, options);
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new ObservationStoreError(
          'CONTROL_INVALID_LIMIT',
          `${name} must be a positive integer`,
        );
      }
    }
  }

  record(
    owner: string,
    observation: ControlObservation,
    options: ObservationRecordOptions = {},
  ): void {
    this.surfaces.purgeIdle();
    this.surfaces.requireOwner(owner);
    validateObservation(observation, this.limits);

    const ownerSurfaces = this.surfaces.owners.get(owner)!;
    const existing = ownerSurfaces.get(observation.surfaceId);
    if (existing) rejectStaleWrite(existing, observation, options);
    if (!existing && options.validationEpoch !== undefined) {
      throw new ObservationStoreError(
        'CONTROL_OBSERVATION_STALE',
        'Observation validation target no longer exists',
      );
    }
    if (!existing) this.surfaces.reserveSurface(owner, observation.surfaceId, ownerSurfaces);

    const entry = existing ?? this.surfaces.emptyEntry();
    const history = [
      clone(observation),
      ...entry.history.filter((candidate) => candidate.observationId !== observation.observationId),
    ].slice(0, this.limits.maxHistoryPerSurface);
    const trimmedHistory = trimHistory(history, this.limits);
    const bytes = byteLength(trimmedHistory);
    this.surfaces.ensureByteCapacity(
      owner,
      observation.surfaceId,
      bytes,
      existing ? existing.bytes + existing.pendingBytes : 0,
    );
    this.surfaces.owners.set(owner, ownerSurfaces);
    entry.history = trimmedHistory;
    entry.bytes = bytes;
    entry.pendingBytes = 0;
    entry.dirtyReasons.clear();
    entry.continuations.clear();
    entry.lastAccessAt = this.surfaces.touch();
    ownerSurfaces.set(observation.surfaceId, entry);
  }

  get(owner: string, surfaceId: string): ControlObservation | undefined {
    this.surfaces.purgeIdle();
    const entry = this.surfaces.find(owner, surfaceId);
    if (!entry) return undefined;
    entry.lastAccessAt = this.surfaces.touch();
    return clone(current(entry));
  }

  validationEpoch(owner: string, surfaceId: string): number {
    this.surfaces.purgeIdle();
    const entry = this.surfaces.requireEntry(owner, surfaceId);
    entry.lastAccessAt = this.surfaces.touch();
    return entry.eventEpoch;
  }

  markDirty(owner: string, surfaceId: string, reason: string, eventKey?: string): void {
    this.surfaces.purgeIdle();
    const entry = this.surfaces.requireEntry(owner, surfaceId);
    const observation = current(entry);
    entry.lastAccessAt = this.surfaces.touch();
    // A repeated event, or a surface that is already dirty, only adds the reason.
    if (!advanceEvent(entry, eventKey) || observation.freshness === 'dirty') {
      rememberDirtyReason(entry, reason);
      return;
    }

    this.pushHistory(owner, surfaceId, entry, {
      ...observation,
      observationId: this.nextId('d'),
      freshness: 'dirty',
    });
    rememberDirtyReason(entry, reason);
    entry.continuations.clear();
  }

  invalidate(owner: string, surfaceId: string, reason: string, eventKey?: string): void {
    this.surfaces.purgeIdle();
    const entry = this.surfaces.requireEntry(owner, surfaceId);
    const observation = current(entry);
    if (!advanceEvent(entry, eventKey)) return;

    this.pushHistory(owner, surfaceId, entry, {
      ...observation,
      observationId: this.nextId('i'),
      generation: observation.generation + 1,
      freshness: 'unknown',
      watchHealth: 'lost',
      revision: observation.revision + 1,
      coverage: { scope: 'surface', truncated: true, omittedNodes: 0 },
      nodes: [],
    });
    rememberDirtyReason(entry, reason);
    entry.continuations.clear();
    entry.lastAccessAt = this.surfaces.touch();
  }

  delta(
    owner: string,
    surfaceId: string,
    baseObservationId: string,
    budget: ObservationDeltaBudget,
  ): ControlObservationResult {
    this.surfaces.purgeIdle();
    if (!Number.isInteger(budget.maxNodes) || budget.maxNodes <= 0) {
      throw new ObservationStoreError(
        'CONTROL_INVALID_BUDGET',
        'maxNodes must be a positive integer',
      );
    }
    const entry = this.surfaces.requireEntry(owner, surfaceId);
    entry.lastAccessAt = this.surfaces.touch();
    const latest = current(entry);
    if (budget.continuationToken) {
      const token = budget.continuationToken;
      const pending = resumeContinuation(entry, token, baseObservationId, latest, budget.maxNodes);
      return pending.kind === 'full'
        ? emitFullPage(entry, token, pending, budget.maxNodes, this.nextIdFn)
        : emitDelta(entry, token, pending, budget.maxNodes, this.nextIdFn);
    }

    entry.continuations.clear();
    entry.pendingBytes = 0;
    const baseline = entry.history.find((item) => item.observationId === baseObservationId);
    if (!baseline) {
      return this.createFullContinuation(
        owner,
        surfaceId,
        entry,
        latest,
        baseObservationId,
        budget.maxNodes,
      );
    }

    const pending = deltaPending(baseline, latest, baseObservationId, budget.maxNodes);
    if (pending.changes.length === 0) {
      return completeDelta(pending, latest.observationId, [], [], undefined, pending.metadata);
    }
    const token = this.nextId('c');
    this.storeContinuation(owner, surfaceId, entry, token, pending);
    return emitDelta(entry, token, pending, budget.maxNodes, this.nextIdFn);
  }

  release(owner: string): void {
    this.surfaces.purgeIdle();
    this.surfaces.release(owner);
  }

  private createFullContinuation(
    owner: string,
    surfaceId: string,
    entry: SurfaceEntry,
    latest: ControlObservation,
    baseObservationId: string,
    maxNodes: number,
  ): ControlObservationResult {
    const pending = fullPending(latest, baseObservationId, maxNodes);
    const fullNodes = pending.fullNodes!;
    if (fullNodes.length <= maxNodes) {
      return {
        kind: 'full',
        observation: clone({ ...latest, nodes: fullNodes }),
        complete: true,
        appliedObservationId: latest.observationId,
      };
    }

    const token = this.nextId('f');
    this.storeContinuation(owner, surfaceId, entry, token, pending);
    return emitFullPage(entry, token, pending, maxNodes, this.nextIdFn);
  }

  /** Replaces any open continuation with this one, charging its bytes to the cache budget. */
  private storeContinuation(
    owner: string,
    surfaceId: string,
    entry: SurfaceEntry,
    token: string,
    pending: PendingDelta,
  ): void {
    entry.continuations.clear();
    entry.pendingBytes = 0;
    const pendingBytes = byteLength(pending);
    this.surfaces.ensureByteCapacity(
      owner,
      surfaceId,
      entry.bytes + pendingBytes,
      entry.bytes + entry.pendingBytes,
    );
    entry.continuations.set(token, pending);
    entry.pendingBytes = pendingBytes;
  }

  /** Prepends a derived observation (dirty or invalidated) to the surface history. */
  private pushHistory(
    owner: string,
    surfaceId: string,
    entry: SurfaceEntry,
    head: ControlObservation,
  ): void {
    const history = trimHistory(
      [head, ...entry.history].slice(0, this.limits.maxHistoryPerSurface),
      this.limits,
    );
    const bytes = byteLength(history);
    this.surfaces.ensureByteCapacity(owner, surfaceId, bytes, entry.bytes + entry.pendingBytes);
    entry.history = history;
    entry.bytes = bytes;
    entry.pendingBytes = 0;
  }

  private nextId(prefix: string): string {
    this.idSequence += 1;
    return `${prefix}${this.idSequence.toString(36).padStart(8, '0')}`;
  }
}
