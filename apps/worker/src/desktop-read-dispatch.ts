import type { WorkerOperation } from '../../../packages/protocol/src/worker.js';
import type {
  DesktopPolicy,
  DesktopTargetIdentity,
  DesktopWindowIdentity,
} from '../../../packages/protocol/src/desktop.js';
import type { DesktopDriver } from '../../../packages/desktop/src/driver.js';
import { DesktopDriverError } from '../../../packages/desktop/src/driver.js';
import { defaultDesktopPolicy } from '../../../packages/security/src/desktop-policy-defaults.js';
import { evaluateDesktopTargetGate } from '../../../packages/security/src/window-gate.js';
import { sameHostApplication, sameWindowInstance } from './desktop-target-identity.js';

async function checkedTarget(
  driver: DesktopDriver,
  window: DesktopWindowIdentity,
  policy: DesktopPolicy,
  sessionId?: string,
): Promise<DesktopTargetIdentity> {
  const target = driver.targetIdentity
    ? await driver.targetIdentity(window.windowId)
    : {
        window,
        windowInstance: { windowId: window.windowId, processId: 0, processStartedAt: '' },
      };
  // Preserve the title observed with the data, even when native host resolution races it.
  const observed = { ...target, window: { ...target.window, title: window.title } };
  const verdict = evaluateDesktopTargetGate(observed, policy, 'capture', sessionId);
  if (!verdict.allowed)
    throw new DesktopDriverError('DESKTOP_INPUT_REFUSED', 'Desktop read target is protected', {
      window: observed.window,
      hostApplication: observed.hostApplication,
      gateVerdict: 'deny',
      gateRule: verdict.reason,
    });
  return observed;
}

export async function dispatchDesktopRead(
  operation: Extract<WorkerOperation, { kind: 'desktop.describe' | 'desktop.capture' }>,
  driver: DesktopDriver,
  sessionId?: string,
) {
  const policy = operation.policy ?? defaultDesktopPolicy();
  if (operation.kind === 'desktop.describe') {
    const window = operation.windowId
      ? (await driver.windows()).find((item) => item.windowId === operation.windowId)
      : await driver.focusedWindow();
    if (!window)
      throw new DesktopDriverError('DESKTOP_INPUT_REFUSED', 'Desktop read target is unavailable');
    const expected = await checkedTarget(driver, window, policy, sessionId);
    const described = await driver.describe({
      windowId: window.windowId,
      maxNodes: operation.maxNodes,
      interactiveOnly: operation.interactiveOnly,
      mode: 'foreground',
      expectedTarget: expected,
    });
    if (described.window.windowId !== window.windowId)
      throw new DesktopDriverError('DESKTOP_INPUT_REFUSED', 'Desktop read target changed');
    const target = await checkedTarget(driver, described.window, policy, sessionId);
    verifyReadIdentity(expected, target, described.window);
    return { ...described, readPolicy: { scope: 'window' as const, targets: [target] } };
  }
  const checkWindows = async () => {
    const windows = await driver.windows();
    const targets = operation.windowId
      ? windows.filter((item) => item.windowId === operation.windowId)
      : windows;
    if (!targets.length)
      throw new DesktopDriverError(
        'DESKTOP_INPUT_REFUSED',
        'Desktop capture target is unavailable',
      );
    return Promise.all(targets.map((window) => checkedTarget(driver, window, policy, sessionId)));
  };
  const expectedTargets = await checkWindows();
  const expected = operation.windowId ? expectedTargets[0] : undefined;
  const captured = await driver.capture(operation.windowId, expected);
  const targets = await checkWindows();
  if (operation.windowId && captured.window?.windowId !== operation.windowId)
    throw new DesktopDriverError('DESKTOP_INPUT_REFUSED', 'Desktop capture target changed');
  if (captured.window) {
    const target = await checkedTarget(driver, captured.window, policy, sessionId);
    const original =
      expected ??
      expectedTargets.find((item) => item.window.windowId === captured.window?.windowId);
    if (!original) throw new DesktopDriverError('DESKTOP_TARGET_CHANGED', 'Capture source changed');
    verifyReadIdentity(original, target, captured.window);
    return { ...captured, readPolicy: { scope: 'window' as const, targets: [target] } };
  }
  return { ...captured, readPolicy: { scope: 'screen' as const, targets } };
}

function verifyReadIdentity(
  expected: DesktopTargetIdentity,
  actual: DesktopTargetIdentity,
  observed: DesktopWindowIdentity,
) {
  const changed =
    !sameWindowInstance(expected.windowInstance, actual.windowInstance) ||
    !sameHostApplication(expected.hostApplication, actual.hostApplication) ||
    [actual.window, observed].some(
      (window) =>
        window.windowId !== expected.window.windowId ||
        window.processName !== expected.window.processName ||
        window.executablePath !== expected.window.executablePath,
    );
  if (changed)
    throw new DesktopDriverError(
      'DESKTOP_TARGET_CHANGED',
      'Read source differs from the authorized window',
    );
}
