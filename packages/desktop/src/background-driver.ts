import type {
  BackgroundActionInput,
  BackgroundActionResult,
  DesktopCapabilities,
  DesktopOwner,
} from '../../protocol/src/desktop.js';
import type { BackgroundDesktopState } from './background-state.js';
import { DesktopDriverError, type DesktopDriver } from './driver.js';

/**
 * Normalizes backgroundActions capability flag.
 * Returns true ONLY if capability object has literal boolean true for backgroundActions.
 */
export function normalizeBackgroundCapability(
  caps?: Partial<DesktopCapabilities> | { backgroundActions?: unknown } | null,
): boolean {
  return caps?.backgroundActions === true;
}

/**
 * Maps errors occurring during or before background action dispatch.
 * Structured native precondition codes are preserved.
 * Transport timeout, death, or unexpected failure after send becomes DESKTOP_OUTCOME_UNKNOWN.
 */
export function mapBackgroundFailure(error: unknown, dispatched: boolean): Error {
  if (dispatched) {
    if (error instanceof DesktopDriverError) {
      if (
        error.code === 'DESKTOP_DRIVER_DIED' ||
        error.code === 'DESKTOP_DRIVER_DEADLINE' ||
        error.code === 'DESKTOP_TIMEOUT'
      ) {
        return new DesktopDriverError(
          'DESKTOP_OUTCOME_UNKNOWN',
          'Desktop action outcome is unknown due to helper timeout or process exit after dispatch',
          error.details,
        );
      }
      return error;
    }
    return new DesktopDriverError(
      'DESKTOP_OUTCOME_UNKNOWN',
      error instanceof Error ? error.message : 'Desktop action outcome is unknown after dispatch',
    );
  }

  if (error instanceof DesktopDriverError) {
    return error;
  }
  return new DesktopDriverError(
    'DESKTOP_HELPER',
    error instanceof Error ? error.message : String(error),
  );
}

export interface ExecuteBackgroundActionOptions {
  state: BackgroundDesktopState;
  driver: DesktopDriver;
  target: BackgroundActionInput;
  owner: DesktopOwner;
  epoch: number;
}

/**
 * Executes a semantic background action against a resolved UIA node.
 * Strictly guarantees:
 * - Opaque ref and window lease resolution against owner and helper epoch.
 * - Single-snapshot invalidation on dispatch regardless of success or failure.
 * - Suspension of window lease if foreground focus change is observed.
 * - Mapping helper timeout or process exit after dispatch to DESKTOP_OUTCOME_UNKNOWN.
 */
export async function executeBackgroundAction(
  options: ExecuteBackgroundActionOptions,
): Promise<BackgroundActionResult> {
  const { state, driver, target, owner, epoch } = options;

  if (typeof driver.backgroundAct !== 'function') {
    throw new DesktopDriverError(
      'DESKTOP_BACKGROUND_UNSUPPORTED',
      'Desktop driver does not support background actions',
    );
  }

  // Pre-dispatch resolution validates owner, lease, snapshot, epoch, and target window instance.
  // Throws DESKTOP_LEASE_EXPIRED, DESKTOP_REF_STALE, DESKTOP_TARGET_CHANGED, or DESKTOP_FOCUS_CHANGED.
  const resolved = state.resolve(owner, target, epoch);

  const nativeRequest = {
    snapshotId: target.snapshotId,
    handle: resolved.handle,
    op: target.op,
    value: target.op === 'setValue' ? target.value : undefined,
    expectedInstance: {
      windowId: resolved.window.windowId,
      processId: resolved.window.processId,
      processStartedAt: resolved.window.processStartedAt,
    },
  };

  let dispatched = false;
  let rawResult: {
    ok: boolean;
    outcome: string;
    focusChanged: boolean;
    toggleState?: 'off' | 'on' | 'indeterminate';
    postActionStateUnknown?: boolean;
  };

  try {
    dispatched = true;
    rawResult = await driver.backgroundAct(nativeRequest);
  } catch (error) {
    throw mapBackgroundFailure(error, dispatched);
  } finally {
    if (dispatched) {
      state.invalidateSnapshot(target.windowLeaseId);
    }
  }

  let postActionStateUnknown = rawResult.postActionStateUnknown;
  const focusChanged = Boolean(rawResult.focusChanged);

  try {
    if (focusChanged) {
      state.suspendLease(target.windowLeaseId);
    }
  } catch {
    postActionStateUnknown = true;
  }

  return {
    ok: true,
    outcome: 'completed',
    window: {
      windowId: resolved.window.windowId,
    },
    snapshotInvalidated: true,
    requiresDescribe: true,
    focusChanged,
    ...(postActionStateUnknown ? { postActionStateUnknown: true } : {}),
    ...(rawResult.toggleState ? { toggleState: rawResult.toggleState } : {}),
  };
}
