import type {
  ControlDelta,
  ControlDeltaMetadata,
  ControlNode,
  ControlObservation,
  ControlObservationResult,
} from '../../protocol/src/control.js';

export interface ObservationStoreLimits {
  maxSurfacesPerOwner: number;
  maxSurfacesTotal: number;
  maxNodesPerSurface: number;
  maxHistoryPerSurface: number;
  maxBytesTotal: number;
  maxBytesPerObservation: number;
  maxBytesPerHistory: number;
  maxImageBytes: number;
  maxImagesPerSurface: number;
  idleRetentionMs: number;
}

export interface ObservationStoreOptions {
  now?: () => number;
  onEvict?: (owner: string, surfaceId: string, reason: string) => void;
}

export interface ObservationDeltaBudget {
  maxNodes: number;
  continuationToken?: string;
}

export interface ObservationRecordOptions {
  validationEpoch?: number;
}

const DEFAULT_LIMITS: ObservationStoreLimits = {
  maxSurfacesPerOwner: 8,
  maxSurfacesTotal: 32,
  maxNodesPerSurface: 5_000,
  maxHistoryPerSurface: 4,
  maxBytesTotal: 64 * 1024 * 1024,
  maxBytesPerObservation: 8 * 1024 * 1024,
  maxBytesPerHistory: 32 * 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  maxImagesPerSurface: 2,
  idleRetentionMs: 60_000,
};
const MAX_DIRTY_REASONS = 16;
const MAX_DIRTY_REASON_LENGTH = 256;

interface PendingChange {
  kind: 'upsert' | 'remove';
  node?: ControlNode;
  ref?: string;
}

interface PendingDelta {
  kind: 'delta' | 'full';
  pageSize: number;
  baseObservationId: string;
  observationId: string;
  surfaceId: string;
  revision: number;
  freshness: ControlObservation['freshness'];
  watchHealth: ControlObservation['watchHealth'];
  changes: PendingChange[];
  fullNodes?: ControlNode[];
  fullObservation?: ControlObservation;
  offset: number;
  nextToken?: string;
  imageSent: boolean;
  metadata: ControlDeltaMetadata;
  coverage: ControlObservation['coverage'];
}

interface SurfaceEntry {
  history: ControlObservation[];
  dirtyReasons: Set<string>;
  continuations: Map<string, PendingDelta>;
  lastAccessAt: number;
  bytes: number;
  pendingBytes: number;
  eventEpoch: number;
  lastEventKey?: string;
}

export class ObservationStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ObservationStoreError';
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function byteLength(value: unknown): number {
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

function projectNodes(
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

function current(entry: SurfaceEntry): ControlObservation {
  const observation = entry.history[0];
  if (!observation) {
    throw new ObservationStoreError('CONTROL_SURFACE_NOT_FOUND', 'Observation is not recorded');
  }
  return observation;
}

export class ObservationStore {
  private readonly limits: ObservationStoreLimits;
  private readonly owners = new Map<string, Map<string, SurfaceEntry>>();
  private readonly now: () => number;
  private readonly onEvict?: ObservationStoreOptions['onEvict'];
  private idSequence = 0;

  constructor(limits: Partial<ObservationStoreLimits> = {}, options: ObservationStoreOptions = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.now = options.now ?? (() => Date.now());
    this.onEvict = options.onEvict;
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
    this.purgeIdle();
    this.requireOwner(owner);
    this.validateObservation(observation);

    const ownerSurfaces = this.owners.get(owner)!;
    const existing = ownerSurfaces.get(observation.surfaceId);
    if (existing) this.rejectStaleWrite(existing, observation, options);
    if (!existing && options.validationEpoch !== undefined) {
      throw new ObservationStoreError(
        'CONTROL_OBSERVATION_STALE',
        'Observation validation target no longer exists',
      );
    }

    if (!existing) {
      while (ownerSurfaces.size >= this.limits.maxSurfacesPerOwner) {
        this.evictOldest(owner, ownerSurfaces, 'owner-quota');
      }
      this.owners.set(owner, ownerSurfaces);
      while (this.surfaceCount() >= this.limits.maxSurfacesTotal) {
        if (!this.evictGlobal(owner, observation.surfaceId, 'global-quota')) {
          throw new ObservationStoreError(
            'CONTROL_SURFACE_QUOTA_EXCEEDED',
            'No surface is available for global quota eviction',
          );
        }
      }
    }

    const entry = existing ?? this.emptyEntry();
    const history = [
      clone(observation),
      ...entry.history.filter((candidate) => candidate.observationId !== observation.observationId),
    ].slice(0, this.limits.maxHistoryPerSurface);
    const trimmedHistory = this.trimHistoryToBudget(this.trimHistoryImages(history));
    const bytes = this.historyBytes(trimmedHistory);
    this.ensureByteCapacity(
      owner,
      observation.surfaceId,
      bytes,
      existing ? existing.bytes + existing.pendingBytes : 0,
    );
    this.owners.set(owner, ownerSurfaces);
    entry.history = trimmedHistory;
    entry.bytes = bytes;
    entry.pendingBytes = 0;
    entry.dirtyReasons.clear();
    entry.continuations.clear();
    entry.lastAccessAt = this.touch();
    ownerSurfaces.set(observation.surfaceId, entry);
  }

  get(owner: string, surfaceId: string): ControlObservation | undefined {
    this.purgeIdle();
    const entry = this.owners.get(owner)?.get(surfaceId);
    if (!entry) return undefined;
    entry.lastAccessAt = this.touch();
    return clone(current(entry));
  }

  validationEpoch(owner: string, surfaceId: string): number {
    this.purgeIdle();
    const entry = this.requireEntry(owner, surfaceId);
    entry.lastAccessAt = this.touch();
    return entry.eventEpoch;
  }

  markDirty(owner: string, surfaceId: string, reason: string, eventKey?: string): void {
    this.purgeIdle();
    const entry = this.requireEntry(owner, surfaceId);
    const observation = current(entry);
    entry.lastAccessAt = this.touch();
    if (!this.advanceEvent(entry, eventKey)) {
      this.rememberDirtyReason(entry, reason);
      return;
    }
    if (observation.freshness === 'dirty') {
      this.rememberDirtyReason(entry, reason);
      return;
    }

    const dirty: ControlObservation = {
      ...observation,
      observationId: this.nextId('d'),
      freshness: 'dirty',
    };
    const history = this.trimHistoryToBudget(
      this.trimHistoryImages([dirty, ...entry.history].slice(0, this.limits.maxHistoryPerSurface)),
    );
    const bytes = this.historyBytes(history);
    this.ensureByteCapacity(owner, surfaceId, bytes, entry.bytes + entry.pendingBytes);
    entry.history = history;
    entry.bytes = bytes;
    entry.pendingBytes = 0;
    this.rememberDirtyReason(entry, reason);
    entry.continuations.clear();
  }

  invalidate(owner: string, surfaceId: string, reason: string, eventKey?: string): void {
    this.purgeIdle();
    const entry = this.requireEntry(owner, surfaceId);
    const observation = current(entry);
    if (!this.advanceEvent(entry, eventKey)) return;

    const invalidated: ControlObservation = {
      ...observation,
      observationId: this.nextId('i'),
      generation: observation.generation + 1,
      freshness: 'unknown',
      watchHealth: 'lost',
      revision: observation.revision + 1,
      coverage: { scope: 'surface', truncated: true, omittedNodes: 0 },
      nodes: [],
    };
    const history = this.trimHistoryToBudget(
      this.trimHistoryImages(
        [invalidated, ...entry.history].slice(0, this.limits.maxHistoryPerSurface),
      ),
    );
    const bytes = this.historyBytes(history);
    this.ensureByteCapacity(owner, surfaceId, bytes, entry.bytes + entry.pendingBytes);
    entry.history = history;
    entry.bytes = bytes;
    entry.pendingBytes = 0;
    this.rememberDirtyReason(entry, reason);
    entry.continuations.clear();
    entry.lastAccessAt = this.touch();
  }

  delta(
    owner: string,
    surfaceId: string,
    baseObservationId: string,
    budget: ObservationDeltaBudget,
  ): ControlObservationResult {
    this.purgeIdle();
    if (!Number.isInteger(budget.maxNodes) || budget.maxNodes <= 0) {
      throw new ObservationStoreError(
        'CONTROL_INVALID_BUDGET',
        'maxNodes must be a positive integer',
      );
    }
    const entry = this.requireEntry(owner, surfaceId);
    entry.lastAccessAt = this.touch();
    const latest = current(entry);
    if (budget.continuationToken) {
      const pending = entry.continuations.get(budget.continuationToken);
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
      if (pending.pageSize !== budget.maxNodes) {
        throw new ObservationStoreError(
          'CONTROL_DELTA_CONTINUATION_MISMATCH',
          'Delta continuation must use its original page size',
        );
      }
      if (pending.kind === 'full') {
        return this.emitFullPage(entry, budget.continuationToken, pending, budget.maxNodes);
      }
      return this.emitDelta(entry, budget.continuationToken, pending, budget.maxNodes);
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

    const pending: PendingDelta = {
      kind: 'delta',
      pageSize: budget.maxNodes,
      baseObservationId,
      observationId: latest.observationId,
      surfaceId: latest.surfaceId,
      revision: latest.revision,
      freshness: latest.freshness,
      watchHealth: latest.watchHealth,
      changes,
      offset: 0,
      imageSent: false,
      metadata: this.metadata(latest, baseline),
      coverage: latest.coverage,
    };
    if (changes.length === 0) {
      return this.emitCompleteDelta(
        pending,
        latest.observationId,
        [],
        [],
        undefined,
        pending.metadata,
      );
    }
    const token = this.nextId('c');
    entry.continuations.clear();
    entry.pendingBytes = 0;
    const pendingBytes = this.pendingBytes(pending);
    this.ensureByteCapacity(
      owner,
      surfaceId,
      entry.bytes + pendingBytes,
      entry.bytes + entry.pendingBytes,
    );
    entry.continuations.set(token, pending);
    entry.pendingBytes = pendingBytes;
    return this.emitDelta(entry, token, pending, budget.maxNodes);
  }

  release(owner: string): void {
    this.purgeIdle();
    const surfaces = this.owners.get(owner);
    if (!surfaces) return;
    for (const surfaceId of surfaces.keys()) this.notifyEviction(owner, surfaceId, 'release');
    this.owners.delete(owner);
  }

  private emptyEntry(): SurfaceEntry {
    return {
      history: [],
      dirtyReasons: new Set<string>(),
      continuations: new Map(),
      lastAccessAt: this.touch(),
      bytes: 0,
      pendingBytes: 0,
      eventEpoch: 0,
    };
  }

  private metadata(latest: ControlObservation, baseline: ControlObservation): ControlDeltaMetadata {
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

  private createFullContinuation(
    owner: string,
    surfaceId: string,
    entry: SurfaceEntry,
    latest: ControlObservation,
    baseObservationId: string,
    maxNodes: number,
  ): ControlObservationResult {
    const fullNodes = projectNodes(latest.nodes).map((node) => clone(node));
    const pending: PendingDelta = {
      kind: 'full',
      pageSize: maxNodes,
      baseObservationId,
      observationId: latest.observationId,
      surfaceId: latest.surfaceId,
      revision: latest.revision,
      freshness: latest.freshness,
      watchHealth: latest.watchHealth,
      changes: [],
      fullNodes,
      fullObservation: clone(latest),
      offset: 0,
      imageSent: false,
      metadata: this.metadata(latest, latest),
      coverage: latest.coverage,
    };
    if (fullNodes.length <= maxNodes) {
      return {
        kind: 'full',
        observation: clone({ ...latest, nodes: fullNodes }),
        complete: true,
        appliedObservationId: latest.observationId,
      };
    }

    const token = this.nextId('f');
    entry.continuations.clear();
    entry.pendingBytes = 0;
    const pendingBytes = this.pendingBytes(pending);
    this.ensureByteCapacity(
      owner,
      surfaceId,
      entry.bytes + pendingBytes,
      entry.bytes + entry.pendingBytes,
    );
    entry.continuations.set(token, pending);
    entry.pendingBytes = pendingBytes;
    return this.emitFullPage(entry, token, pending, maxNodes);
  }

  private emitFullPage(
    entry: SurfaceEntry,
    token: string,
    pending: PendingDelta,
    maxNodes: number,
  ): ControlObservationResult {
    const nodes = pending.fullNodes ?? [];
    const page = nodes.slice(pending.offset, pending.offset + maxNodes);
    const nextOffset = pending.offset + page.length;
    const complete = nextOffset >= nodes.length;
    const continuation = complete
      ? undefined
      : this.nextContinuation(entry, token, pending, nextOffset, nodes.length);
    if (complete) {
      for (const existingToken of entry.continuations.keys()) {
        if (existingToken !== token) entry.continuations.delete(existingToken);
      }
    }
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

  private emitDelta(
    entry: SurfaceEntry,
    token: string,
    pending: PendingDelta,
    maxNodes: number,
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
      : this.nextContinuation(entry, token, pending, nextOffset);
    if (complete) {
      for (const existingToken of entry.continuations.keys()) {
        if (existingToken !== token) entry.continuations.delete(existingToken);
      }
    }
    return this.emitCompleteDelta(
      pending,
      complete ? pending.observationId : pending.baseObservationId,
      upsert,
      remove,
      continuation,
      this.pageMetadata(pending),
      pending.changes.length - nextOffset,
    );
  }

  private nextContinuation(
    entry: SurfaceEntry,
    token: string,
    pending: PendingDelta,
    nextOffset: number,
    totalChanges = pending.changes.length,
  ): ControlDelta['continuation'] {
    const nextToken =
      pending.nextToken ??
      (() => {
        const created = this.nextId(pending.kind === 'full' ? 'f' : 'c');
        pending.nextToken = created;
        entry.continuations.set(created, {
          ...pending,
          offset: nextOffset,
          nextToken: undefined,
          imageSent: true,
        });
        return created;
      })();
    for (const existingToken of entry.continuations.keys()) {
      if (existingToken !== token && existingToken !== nextToken) {
        entry.continuations.delete(existingToken);
      }
    }
    return {
      token: nextToken,
      baseObservationId: pending.baseObservationId,
      observationId: pending.observationId,
      offset: nextOffset,
      totalChanges,
    };
  }

  private pageMetadata(pending: PendingDelta): ControlDeltaMetadata {
    if (pending.metadata.imageChanged && !pending.imageSent) return clone(pending.metadata);
    const { image: _image, ...withoutImage } = pending.metadata;
    return { ...withoutImage, imageChanged: false };
  }

  private emitCompleteDelta(
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

  private validateObservation(observation: ControlObservation): void {
    const nodes = projectNodes(observation.nodes);
    if (nodes.length > this.limits.maxNodesPerSurface) {
      throw new ObservationStoreError(
        'CONTROL_OBSERVATION_TOO_LARGE',
        `surface ${observation.surfaceId} contains ${nodes.length} nodes; limit is ${this.limits.maxNodesPerSurface}`,
      );
    }
    if (new Set(nodes.map((node) => node.ref)).size !== nodes.length) {
      throw new ObservationStoreError(
        'CONTROL_DUPLICATE_REF',
        'Observation contains duplicate node refs',
      );
    }
    if (observation.image && byteLength(observation.image.dataUri) > this.limits.maxImageBytes) {
      throw new ObservationStoreError(
        'CONTROL_IMAGE_TOO_LARGE',
        'Observation image exceeds the configured limit',
      );
    }
    if (byteLength(observation) > this.limits.maxBytesPerObservation) {
      throw new ObservationStoreError(
        'CONTROL_OBSERVATION_TOO_LARGE',
        'Observation exceeds the configured byte limit',
      );
    }
  }

  private rememberDirtyReason(entry: SurfaceEntry, reason: string): void {
    const bounded = reason.slice(0, MAX_DIRTY_REASON_LENGTH);
    entry.dirtyReasons.delete(bounded);
    entry.dirtyReasons.add(bounded);
    while (entry.dirtyReasons.size > MAX_DIRTY_REASONS) {
      const oldest = entry.dirtyReasons.values().next().value as string | undefined;
      if (oldest === undefined) break;
      entry.dirtyReasons.delete(oldest);
    }
  }

  private rejectStaleWrite(
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
      throw new ObservationStoreError(
        'CONTROL_OBSERVATION_STALE',
        'Observation generation is stale',
      );
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

  private ensureByteCapacity(
    owner: string,
    surfaceId: string,
    candidateBytes: number,
    existingBytes: number,
  ): void {
    while (this.totalBytes() - existingBytes + candidateBytes > this.limits.maxBytesTotal) {
      if (!this.evictGlobal(owner, surfaceId, 'byte-quota')) {
        throw new ObservationStoreError(
          'CONTROL_CACHE_BYTES_EXCEEDED',
          'Observation cache byte limit exceeded',
        );
      }
    }
  }

  private trimHistoryImages(history: ControlObservation[]): ControlObservation[] {
    let images = 0;
    return history.map((observation) => {
      if (!observation.image) return observation;
      images += 1;
      return images <= this.limits.maxImagesPerSurface
        ? observation
        : (() => {
            const { image: _image, ...withoutImage } = observation;
            return withoutImage;
          })();
    });
  }

  private trimHistoryToBudget(history: ControlObservation[]): ControlObservation[] {
    const retained = [...history];
    while (retained.length > 1 && this.historyBytes(retained) > this.limits.maxBytesPerHistory) {
      retained.pop();
    }
    if (this.historyBytes(retained) > this.limits.maxBytesPerHistory) {
      throw new ObservationStoreError(
        'CONTROL_CACHE_BYTES_EXCEEDED',
        'Current observation exceeds the history byte limit',
      );
    }
    return retained;
  }

  private historyBytes(history: ControlObservation[]): number {
    return byteLength(history);
  }

  private pendingBytes(pending: PendingDelta): number {
    return byteLength(pending);
  }

  private requireOwner(owner: string): void {
    if (!owner || typeof owner !== 'string') {
      throw new ObservationStoreError('CONTROL_OWNER_FORBIDDEN', 'A runtime owner is required');
    }
    if (!this.owners.has(owner)) this.owners.set(owner, new Map());
  }

  private requireEntry(owner: string, surfaceId: string): SurfaceEntry {
    if (!this.owners.has(owner)) {
      throw new ObservationStoreError(
        'CONTROL_OWNER_FORBIDDEN',
        'Observation belongs to another owner',
      );
    }
    const entry = this.owners.get(owner)!.get(surfaceId);
    if (!entry)
      throw new ObservationStoreError('CONTROL_SURFACE_NOT_FOUND', `Unknown surface ${surfaceId}`);
    return entry;
  }

  private advanceEvent(entry: SurfaceEntry, eventKey?: string): boolean {
    if (eventKey !== undefined && entry.lastEventKey === eventKey) return false;
    entry.eventEpoch += 1;
    entry.lastEventKey = eventKey;
    return true;
  }

  private evictOldest(owner: string, surfaces: Map<string, SurfaceEntry>, reason: string): void {
    const candidate = [...surfaces.entries()].sort(
      ([, left], [, right]) => left.lastAccessAt - right.lastAccessAt,
    )[0];
    if (!candidate) return;
    surfaces.delete(candidate[0]);
    this.notifyEviction(owner, candidate[0], reason);
  }

  private evictGlobal(excludeOwner: string, excludeSurface: string, reason: string): boolean {
    let candidate: { owner: string; surfaceId: string; entry: SurfaceEntry } | undefined;
    for (const [owner, surfaces] of this.owners) {
      for (const [surfaceId, entry] of surfaces) {
        if (owner === excludeOwner && surfaceId === excludeSurface) continue;
        if (!candidate || entry.lastAccessAt < candidate.entry.lastAccessAt) {
          candidate = { owner, surfaceId, entry };
        }
      }
    }
    if (!candidate) return false;
    const surfaces = this.owners.get(candidate.owner)!;
    surfaces.delete(candidate.surfaceId);
    this.notifyEviction(candidate.owner, candidate.surfaceId, reason);
    if (surfaces.size === 0) this.owners.delete(candidate.owner);
    return true;
  }

  private purgeIdle(): void {
    const now = this.now();
    for (const [owner, surfaces] of [...this.owners]) {
      for (const [surfaceId, entry] of [...surfaces]) {
        if (now - entry.lastAccessAt >= this.limits.idleRetentionMs) {
          surfaces.delete(surfaceId);
          this.notifyEviction(owner, surfaceId, 'idle');
        }
      }
      if (surfaces.size === 0) this.owners.delete(owner);
    }
  }

  private notifyEviction(owner: string, surfaceId: string, reason: string): void {
    this.onEvict?.(owner, surfaceId, reason);
  }

  private surfaceCount(): number {
    let count = 0;
    for (const surfaces of this.owners.values()) count += surfaces.size;
    return count;
  }

  private totalBytes(): number {
    let total = 0;
    for (const surfaces of this.owners.values()) {
      for (const entry of surfaces.values()) total += entry.bytes + entry.pendingBytes;
    }
    return total;
  }

  private touch(): number {
    return this.now();
  }

  private nextId(prefix: string): string {
    this.idSequence += 1;
    return `${prefix}${this.idSequence.toString(36).padStart(8, '0')}`;
  }
}
