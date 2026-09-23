import type {
  ControlDeltaMetadata,
  ControlNode,
  ControlObservation,
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

export const DEFAULT_LIMITS: ObservationStoreLimits = {
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

export interface PendingChange {
  kind: 'upsert' | 'remove';
  node?: ControlNode;
  ref?: string;
}

export interface PendingDelta {
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

export interface SurfaceEntry {
  history: ControlObservation[];
  dirtyReasons: Set<string>;
  continuations: Map<string, PendingDelta>;
  lastAccessAt: number;
  bytes: number;
  pendingBytes: number;
  eventEpoch: number;
  lastEventKey?: string;
}

/** Mints the short, monotonically increasing IDs the store hands out. */
export type NextId = (prefix: string) => string;

export class ObservationStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ObservationStoreError';
  }
}
