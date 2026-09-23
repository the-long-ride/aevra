import {
  ObservationStoreError,
  type ObservationStoreLimits,
  type ObservationStoreOptions,
  type SurfaceEntry,
} from './observation-types.js';

/** Owner-to-surface bookkeeping: quotas, the byte budget, idle purge, and eviction. */
export class SurfaceRegistry {
  readonly owners = new Map<string, Map<string, SurfaceEntry>>();
  private readonly now: () => number;
  private readonly onEvict?: ObservationStoreOptions['onEvict'];

  constructor(
    private readonly limits: ObservationStoreLimits,
    options: ObservationStoreOptions,
  ) {
    this.now = options.now ?? (() => Date.now());
    this.onEvict = options.onEvict;
  }

  touch(): number {
    return this.now();
  }

  emptyEntry(): SurfaceEntry {
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

  find(owner: string, surfaceId: string): SurfaceEntry | undefined {
    return this.owners.get(owner)?.get(surfaceId);
  }

  requireOwner(owner: string): void {
    if (!owner || typeof owner !== 'string') {
      throw new ObservationStoreError('CONTROL_OWNER_FORBIDDEN', 'A runtime owner is required');
    }
    if (!this.owners.has(owner)) this.owners.set(owner, new Map());
  }

  requireEntry(owner: string, surfaceId: string): SurfaceEntry {
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

  /** Makes room for a new surface, evicting within the owner first and then globally. */
  reserveSurface(owner: string, surfaceId: string, ownerSurfaces: Map<string, SurfaceEntry>) {
    while (ownerSurfaces.size >= this.limits.maxSurfacesPerOwner) {
      this.evictOldest(owner, ownerSurfaces, 'owner-quota');
    }
    this.owners.set(owner, ownerSurfaces);
    while (this.surfaceCount() >= this.limits.maxSurfacesTotal) {
      if (!this.evictGlobal(owner, surfaceId, 'global-quota')) {
        throw new ObservationStoreError(
          'CONTROL_SURFACE_QUOTA_EXCEEDED',
          'No surface is available for global quota eviction',
        );
      }
    }
  }

  ensureByteCapacity(
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

  release(owner: string): void {
    const surfaces = this.owners.get(owner);
    if (!surfaces) return;
    for (const surfaceId of surfaces.keys()) this.notifyEviction(owner, surfaceId, 'release');
    this.owners.delete(owner);
  }

  purgeIdle(): void {
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
}
