import { randomUUID } from 'node:crypto';
import type { WorkerOperation } from '../../../packages/protocol/src/worker.js';
import type { DesktopOwner } from '../../../packages/protocol/src/desktop.js';
import { executeBackgroundAction } from '../../../packages/desktop/src/background-driver.js';
import { DesktopDriverError } from '../../../packages/desktop/src/driver.js';
import { detectInstalledApps } from '../../../packages/desktop/src/installed-apps.js';
import type { DesktopSessionRegistry } from '../../../packages/desktop/src/registry.js';
import { evaluateWindowGate } from '../../../packages/security/src/window-gate.js';

type DesktopOperation = Extract<WorkerOperation, { kind: `desktop.${string}` }>;

/**
 * A `startsWith` check reads the same at runtime but narrows nothing, so the
 * dispatcher needs a real predicate to hand over a typed operation. Mirrors
 * `isBrowserOperation` in browser-dispatch.ts.
 */
export function isDesktopOperation(op: WorkerOperation): op is DesktopOperation {
  return op.kind.startsWith('desktop.');
}

export async function dispatchDesktopOperation(
  operation: DesktopOperation,
  registry: DesktopSessionRegistry,
  owner?: DesktopOwner,
): Promise<unknown> {
  // Connect, status, and disconnect stay off the queue: the kill switch must
  // reach a wedged session. desktop.apps joins them for a different reason -
  // it is a pure registry read with no dependency on a live session at all.
  if (operation.kind === 'desktop.connect') return registry.connect();
  if (operation.kind === 'desktop.status') return registry.status();
  if (operation.kind === 'desktop.disconnect') return registry.disconnect();
  if (operation.kind === 'desktop.apps') return detectInstalledApps();

  return registry.run(async (driver, epoch) => {
    if (operation.kind === 'desktop.windows') return driver.windows();

    if (operation.kind === 'desktop.describe') {
      if (operation.mode === 'background') {
        if (!owner) {
          throw new DesktopDriverError(
            'DESKTOP_LEASE_EXPIRED',
            'Background describe requires verified session owner',
          );
        }
        const windowId = operation.windowId;
        if (!windowId) {
          throw new DesktopDriverError(
            'DESKTOP_TARGET_CHANGED',
            'Window ID is required for background describe',
          );
        }
        if (
          typeof driver.targetIdentity !== 'function' ||
          typeof driver.describeBackground !== 'function'
        ) {
          throw new DesktopDriverError(
            'DESKTOP_BACKGROUND_UNSUPPORTED',
            'Driver does not support background operations',
          );
        }

        const target = await driver.targetIdentity(windowId);

        if (operation.policy) {
          const verdict = evaluateWindowGate(target.window, operation.policy, 'background');
          if (!verdict.allowed) {
            throw new DesktopDriverError(
              'DESKTOP_INPUT_REFUSED',
              `Target refused by policy: ${verdict.reason} (${target.window.processName ?? 'unattributable window'})`,
              { window: target.window, gateVerdict: 'deny' as const, gateRule: verdict.reason },
            );
          }
        }

        const { windowLeaseId, leaseExpiresAt } = registry.backgroundState.acquire(
          owner,
          target.windowInstance,
          epoch,
        );
        const snapshotId = randomUUID();
        const describeResult = await driver.describeBackground({
          windowId,
          snapshotId,
          maxNodes: operation.maxNodes,
          interactiveOnly: operation.interactiveOnly,
        });

        const nodeBindings = describeResult.nodes.map((n) => ({
          ref: n.ref,
          handle: (n as any).handle ?? n.ref,
        }));
        registry.backgroundState.bind(owner, windowLeaseId, snapshotId, nodeBindings, epoch);

        return {
          window: describeResult.window,
          nodes: describeResult.nodes.map((node) => {
            const { handle: _handle, ...publicNode } = node;
            return publicNode;
          }),
          truncated: describeResult.truncated,
          snapshotId,
          windowLeaseId,
          leaseExpiresAt,
        };
      }

      return driver.describe({
        windowId: operation.windowId,
        maxNodes: operation.maxNodes,
        interactiveOnly: operation.interactiveOnly,
        mode: 'foreground',
      });
    }

    if (operation.kind === 'desktop.capture') return driver.capture(operation.windowId);

    if (operation.kind === 'desktop.releaseWindow') {
      if (!owner) {
        throw new DesktopDriverError(
          'DESKTOP_LEASE_EXPIRED',
          'Release window requires verified session owner',
        );
      }
      const released = registry.backgroundState.release(
        owner,
        operation.windowId,
        operation.windowLeaseId,
      );
      if (!released) {
        throw new DesktopDriverError(
          'DESKTOP_LEASE_EXPIRED',
          'Window lease not found, already expired, or owner mismatch',
        );
      }
      if (typeof driver.releaseBackgroundSnapshot === 'function') {
        await driver.releaseBackgroundSnapshot(operation.windowLeaseId).catch(() => {});
      }
      return { ok: true, released: true };
    }

    if (operation.kind === 'desktop.backgroundAct') {
      if (!owner) {
        throw new DesktopDriverError(
          'DESKTOP_LEASE_EXPIRED',
          'Background action requires verified session owner',
        );
      }

      // Order invariant:
      // 1. Resolve owner/ref/lease/snapshot/epoch
      const resolved = registry.backgroundState.resolve(owner, operation.action, epoch);

      // 2. Read live target identity
      if (typeof driver.targetIdentity !== 'function') {
        throw new DesktopDriverError(
          'DESKTOP_BACKGROUND_UNSUPPORTED',
          'Driver does not support target identity',
        );
      }
      const liveTarget = await driver.targetIdentity(resolved.window.windowId);
      if (
        liveTarget.windowInstance.processId !== resolved.window.processId ||
        liveTarget.windowInstance.processStartedAt !== resolved.window.processStartedAt
      ) {
        throw new DesktopDriverError('DESKTOP_TARGET_CHANGED', 'Window process instance changed');
      }

      // 3. Policy against live target identity
      const verdict = evaluateWindowGate(liveTarget.window, operation.policy, 'background');
      if (!verdict.allowed) {
        throw new DesktopDriverError(
          'DESKTOP_INPUT_REFUSED',
          `Background action refused: ${verdict.reason} (${liveTarget.window.processName ?? 'unattributable window'})`,
          { window: liveTarget.window, gateVerdict: 'deny' as const, gateRule: verdict.reason },
        );
      }

      // 4. Native guard and provider dispatch
      const result = await executeBackgroundAction({
        state: registry.backgroundState,
        driver,
        target: operation.action,
        owner,
        epoch,
      });

      return {
        ...result,
        window: liveTarget.window,
        gateVerdict: 'allow' as const,
        gateRule: verdict.reason,
      };
    }

    // Core issued the policy in the signed envelope; only Worker can see which
    // window has focus at this instant, so Worker applies it.
    const identity = await driver.focusedWindow();

    // Reject a foreign or same-owner legacy foreground mutation against a background-owned target
    if (registry.backgroundState.isWindowLeased(identity.windowId)) {
      throw new DesktopDriverError(
        'DESKTOP_WINDOW_BUSY',
        'Target window is currently leased for background automation',
        {
          window: identity,
          gateVerdict: 'deny' as const,
          gateRule: 'window leased for background automation',
        },
      );
    }

    const verdict = evaluateWindowGate(identity, operation.policy, 'input');
    // The window identity and the gate's verdict are attached to the result
    // (allowed path) or to the thrown error's `details` (refused path) so the
    // MCP tool layer can audit "which window, and did the gate allow it" for
    // every input action - previously this was discarded here and the audit
    // trail recorded neither, for the only operations the gate governs.
    if (!verdict.allowed) {
      throw new DesktopDriverError(
        'DESKTOP_INPUT_REFUSED',
        `Input refused: ${verdict.reason} (${identity.processName ?? 'unattributable window'})`,
        { window: identity, gateVerdict: 'deny' as const, gateRule: verdict.reason },
      );
    }
    const result = await driver.act(operation);
    return { ...result, window: identity, gateVerdict: 'allow' as const, gateRule: verdict.reason };
  });
}
