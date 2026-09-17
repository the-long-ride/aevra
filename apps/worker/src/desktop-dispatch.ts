import type { WorkerOperation } from '../../../packages/protocol/src/worker.js';
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
): Promise<unknown> {
  // Connect, status, and disconnect stay off the queue: the kill switch must
  // reach a wedged session. desktop.apps joins them for a different reason -
  // it is a pure registry read with no dependency on a live session at all.
  if (operation.kind === 'desktop.connect') return registry.connect();
  if (operation.kind === 'desktop.status') return registry.status();
  if (operation.kind === 'desktop.disconnect') return registry.disconnect();
  if (operation.kind === 'desktop.apps') return detectInstalledApps();

  return registry.run(async (driver) => {
    if (operation.kind === 'desktop.windows') return driver.windows();
    if (operation.kind === 'desktop.describe') {
      return driver.describe({
        windowId: operation.windowId,
        maxNodes: operation.maxNodes,
        interactiveOnly: operation.interactiveOnly,
      });
    }
    if (operation.kind === 'desktop.capture') return driver.capture(operation.windowId);

    // Core issued the policy in the signed envelope; only Worker can see which
    // window has focus at this instant, so Worker applies it.
    const identity = await driver.focusedWindow();
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
