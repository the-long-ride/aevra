import { randomUUID } from 'node:crypto';
import type {
  BackgroundTarget,
  DesktopOwner,
  DesktopWindowInstance,
  VerifiedWindowHost,
} from '../../protocol/src/desktop.js';
import { canonicalExecutablePath } from '../../security/src/window-gate.js';
import { DesktopDriverError } from './driver.js';

export type WindowInstance = DesktopWindowInstance;

export interface SnapshotNodeBinding {
  ref: string;
  handle: string;
}

export interface BackgroundDesktopStateDeps {
  now(): number;
  id(): string;
}

interface WindowLease {
  leaseId: string;
  owner: DesktopOwner;
  window: WindowInstance;
  hostApplication?: VerifiedWindowHost;
  epoch: number;
  expiresAt: number;
  activeSnapshot?: {
    snapshotId: string;
    epoch: number;
    nodes: Map<string, string>; // ref -> handle
  };
  suspended?: boolean;
}

const DEFAULT_TTL_MS = 60_000;
const MAX_LEASES_PER_OWNER = 8;
const MAX_LEASES_HOST = 32;
const MAX_NODES_PER_SNAPSHOT = 5_000;

function windowScopeKey(window: WindowInstance): string {
  return `${window.windowId}:${window.processId}:${window.processStartedAt}`;
}

function hostScopeKey(host?: VerifiedWindowHost): string {
  if (!host) return '';
  return `${host.instance.windowId}:${host.instance.processId}:${host.instance.processStartedAt}:${canonicalExecutablePath(host.executablePath)}`;
}

function sameHost(a?: VerifiedWindowHost, b?: VerifiedWindowHost): boolean {
  return hostScopeKey(a) === hostScopeKey(b);
}

function isSameOwner(a: DesktopOwner, b: DesktopOwner): boolean {
  return a.sessionId === b.sessionId && a.workspaceId === b.workspaceId;
}

export class BackgroundDesktopState {
  private readonly now: () => number;
  private readonly id: () => string;
  private leases = new Map<string, WindowLease>(); // leaseId -> WindowLease

  constructor(deps?: Partial<BackgroundDesktopStateDeps>) {
    this.now = deps?.now ?? (() => Date.now());
    this.id = deps?.id ?? (() => randomUUID());
  }

  private pruneExpired(): void {
    const currentTime = this.now();
    for (const [leaseId, lease] of this.leases.entries()) {
      if (lease.expiresAt <= currentTime) {
        this.leases.delete(leaseId);
      }
    }
  }

  acquire(
    owner: DesktopOwner,
    window: WindowInstance,
    epoch: number,
    hostApplication?: VerifiedWindowHost,
  ): { windowLeaseId: string; leaseExpiresAt: string } {
    this.pruneExpired();
    const currentTime = this.now();
    const targetKey = windowScopeKey(window);

    // Check if target window is already leased
    let existingLease: WindowLease | undefined;
    for (const lease of this.leases.values()) {
      if (windowScopeKey(lease.window) === targetKey) {
        if (!sameHost(lease.hostApplication, hostApplication)) {
          throw new DesktopDriverError(
            'DESKTOP_TARGET_CHANGED',
            'Verified host application changed for the leased target window',
          );
        }
        if (!isSameOwner(lease.owner, owner)) {
          const retryAfterMs = Math.max(1_000, lease.expiresAt - currentTime);
          throw new DesktopDriverError(
            'DESKTOP_WINDOW_BUSY',
            'Window is owned by another session',
            {
              retryAfterMs,
            },
          );
        }
        existingLease = lease;
        break;
      }
    }

    if (existingLease) {
      // Renew existing lease for the same owner and window
      existingLease.expiresAt = currentTime + DEFAULT_TTL_MS;
      existingLease.epoch = epoch;
      return {
        windowLeaseId: existingLease.leaseId,
        leaseExpiresAt: new Date(existingLease.expiresAt).toISOString(),
      };
    }

    // Check host-wide limit
    if (this.leases.size >= MAX_LEASES_HOST) {
      throw new DesktopDriverError('DESKTOP_WINDOW_BUSY', 'Host window lease limit reached', {
        retryAfterMs: 5_000,
      });
    }

    // Check per-owner limit
    let ownerLeaseCount = 0;
    for (const lease of this.leases.values()) {
      if (isSameOwner(lease.owner, owner)) {
        ownerLeaseCount++;
      }
    }
    if (ownerLeaseCount >= MAX_LEASES_PER_OWNER) {
      throw new DesktopDriverError(
        'DESKTOP_WINDOW_BUSY',
        'Session window lease quota exceeded (maximum 8 active window leases)',
        { retryAfterMs: 5_000 },
      );
    }

    const leaseId = this.id();
    const expiresAt = currentTime + DEFAULT_TTL_MS;
    const newLease: WindowLease = {
      leaseId,
      owner,
      window,
      ...(hostApplication ? { hostApplication } : {}),
      epoch,
      expiresAt,
    };
    this.leases.set(leaseId, newLease);

    return {
      windowLeaseId: leaseId,
      leaseExpiresAt: new Date(expiresAt).toISOString(),
    };
  }

  bind(
    owner: DesktopOwner,
    windowLeaseId: string,
    snapshotId: string,
    nodes: SnapshotNodeBinding[],
    epoch?: number,
  ): void {
    this.pruneExpired();
    const lease = this.leases.get(windowLeaseId);
    if (!lease || !isSameOwner(lease.owner, owner)) {
      throw new DesktopDriverError('DESKTOP_LEASE_EXPIRED', 'Window lease not found or expired');
    }

    if (nodes.length > MAX_NODES_PER_SNAPSHOT) {
      throw new DesktopDriverError(
        'DESKTOP_PATTERN_UNSUPPORTED',
        `Snapshot exceeds maximum node limit (${MAX_NODES_PER_SNAPSHOT})`,
      );
    }

    const nodeMap = new Map<string, string>();
    for (const node of nodes) {
      nodeMap.set(node.ref, node.handle);
    }

    lease.suspended = false;
    lease.activeSnapshot = {
      snapshotId,
      epoch: epoch ?? lease.epoch,
      nodes: nodeMap,
    };
  }

  resolve(
    owner: DesktopOwner,
    target: BackgroundTarget,
    epoch: number,
  ): { handle: string; window: WindowInstance; hostApplication?: VerifiedWindowHost } {
    this.pruneExpired();
    const currentTime = this.now();
    const lease = this.leases.get(target.windowLeaseId);

    if (!lease || !isSameOwner(lease.owner, owner)) {
      throw new DesktopDriverError(
        'DESKTOP_LEASE_EXPIRED',
        'Window lease expired or owner mismatch',
      );
    }

    if (lease.suspended) {
      throw new DesktopDriverError(
        'DESKTOP_FOCUS_CHANGED',
        'Window lease is suspended due to observed focus change; fresh background describe required',
      );
    }

    if (lease.expiresAt <= currentTime) {
      this.leases.delete(target.windowLeaseId);
      throw new DesktopDriverError('DESKTOP_LEASE_EXPIRED', 'Window lease expired');
    }

    if (lease.epoch !== epoch) {
      throw new DesktopDriverError('DESKTOP_REF_STALE', 'Helper epoch mismatch');
    }

    if (lease.window.windowId !== target.windowId) {
      throw new DesktopDriverError('DESKTOP_TARGET_CHANGED', 'Window ID mismatch for lease');
    }

    if (!lease.activeSnapshot || lease.activeSnapshot.snapshotId !== target.snapshotId) {
      throw new DesktopDriverError('DESKTOP_REF_STALE', 'Snapshot invalidated or stale');
    }

    if (lease.activeSnapshot.epoch !== epoch) {
      throw new DesktopDriverError('DESKTOP_REF_STALE', 'Snapshot helper epoch mismatch');
    }

    const handle = lease.activeSnapshot.nodes.get(target.ref);
    if (!handle) {
      throw new DesktopDriverError(
        'DESKTOP_REF_STALE',
        `Node reference not found in snapshot: ${target.ref}`,
      );
    }

    // Successful resolution touches/renews lease TTL
    lease.expiresAt = currentTime + DEFAULT_TTL_MS;

    return {
      handle,
      window: lease.window,
      ...(lease.hostApplication ? { hostApplication: lease.hostApplication } : {}),
    };
  }

  suspendLease(windowLeaseId: string): void {
    const lease = this.leases.get(windowLeaseId);
    if (lease) {
      lease.suspended = true;
      lease.activeSnapshot = undefined;
    }
  }

  invalidateSnapshot(windowLeaseId: string): void {
    const lease = this.leases.get(windowLeaseId);
    if (lease) {
      lease.activeSnapshot = undefined;
    }
  }

  release(owner: DesktopOwner, windowId: string, windowLeaseId: string): boolean {
    const lease = this.leases.get(windowLeaseId);
    if (!lease) {
      return false;
    }
    if (!isSameOwner(lease.owner, owner)) {
      return false;
    }
    if (lease.window.windowId !== windowId) {
      return false;
    }
    this.leases.delete(windowLeaseId);
    return true;
  }

  isWindowLeased(windowId: string): boolean {
    this.pruneExpired();
    for (const lease of this.leases.values()) {
      if (lease.window.windowId === windowId) {
        return true;
      }
    }
    return false;
  }

  reset(): void {
    this.leases.clear();
  }
}
