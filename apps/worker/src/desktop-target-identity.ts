import type {
  DesktopTargetIdentity,
  VerifiedWindowHost,
} from '../../../packages/protocol/src/desktop.js';
import { canonicalExecutablePath } from '../../../packages/security/src/window-gate.js';

export function sameHostApplication(a?: VerifiedWindowHost, b?: VerifiedWindowHost): boolean {
  if (!a || !b) return a === b;
  return (
    a.instance.windowId === b.instance.windowId &&
    a.instance.processId === b.instance.processId &&
    a.instance.processStartedAt === b.instance.processStartedAt &&
    canonicalExecutablePath(a.executablePath) === canonicalExecutablePath(b.executablePath)
  );
}

export function sameWindowInstance(
  a: DesktopTargetIdentity['windowInstance'],
  b: DesktopTargetIdentity['windowInstance'],
): boolean {
  return (
    a.windowId === b.windowId &&
    a.processId === b.processId &&
    a.processStartedAt === b.processStartedAt
  );
}
