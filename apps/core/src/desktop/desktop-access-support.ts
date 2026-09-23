import type {
  DesktopAppGrant,
  DesktopTargetIdentity,
  VerifiedWindowHost,
} from '../../../../packages/protocol/src/desktop.js';
import type { WorkerOperation, WorkerResult } from '../../../../packages/protocol/src/worker.js';
import {
  DesktopAccessRepository,
  type DesktopAccessRequestRecord,
  type DesktopAppGrantRecord,
} from '../../../../packages/store/src/desktop-access.js';
import {
  canonicalExecutablePath,
  basename,
} from '../../../../packages/security/src/window-gate.js';

export const REQUEST_LIFETIME_MS = 10 * 60_000;

interface WorkerLike {
  execute(input: {
    sessionId: string;
    workspaceId: string;
    roots: any[];
    operation: WorkerOperation;
    executionMode: 'host';
  }): Promise<WorkerResult>;
}

interface SessionLike {
  get(sessionId: string): { actor: string } | null;
  leaseForWorkspace(sessionId: string, workspaceId: string): { capabilities: string[] } | null;
}

export interface DesktopAccessServiceDeps {
  repository: DesktopAccessRepository;
  worker: WorkerLike;
  sessions: SessionLike;
  capabilityRoots(workspaceId: string): any[];
  audit?: { append(input: any): unknown };
}

interface HostBinding {
  targetPath: string;
  host: VerifiedWindowHost;
  displayName: string;
}

export function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function isWebViewRuntime(identity: DesktopTargetIdentity): boolean {
  return [
    identity.window.processName,
    identity.window.executablePath ? basename(identity.window.executablePath) : undefined,
  ].some((value) => value?.toLowerCase() === 'msedgewebview2.exe');
}

function executablePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const path = value.trim().replaceAll('/', '\\');
  const canonical = canonicalExecutablePath(path);
  const absolute = /^[a-z]:\\/i.test(canonical) || /^\\\\[^\\]+\\[^\\]+\\/.test(canonical);
  if (!absolute || !canonical.toLowerCase().endsWith('.exe')) return undefined;
  return path;
}

function bindingFor(identity: DesktopTargetIdentity): HostBinding {
  const targetPath = executablePath(identity.window.executablePath);
  if (!targetPath || !identity.window.processName) {
    fail('DESKTOP_IDENTITY_UNAVAILABLE', 'The target executable identity is unavailable');
  }
  if (identity.windowInstance.windowId !== identity.window.windowId) {
    fail('DESKTOP_TARGET_CHANGED', 'The target HWND changed while its identity was read');
  }

  let host: VerifiedWindowHost;
  if (isWebViewRuntime(identity)) {
    if (!identity.hostApplication) {
      fail(
        'DESKTOP_HOST_UNVERIFIED',
        'Aevra could not verify which application owns this WebView2 window',
      );
    }
    host = identity.hostApplication;
  } else {
    host = { executablePath: targetPath, instance: identity.windowInstance };
  }

  const hostPath = executablePath(host.executablePath);
  if (
    !hostPath ||
    (host.instance.processId === identity.windowInstance.processId && isWebViewRuntime(identity))
  ) {
    fail('DESKTOP_HOST_UNVERIFIED', 'The verified host identity is incomplete');
  }
  const name = basename(hostPath).replace(/\.exe$/i, '') || basename(hostPath);
  return { targetPath, host: { ...host, executablePath: hostPath }, displayName: name };
}

export function sameBinding(
  request: DesktopAccessRequestRecord,
  identity: DesktopTargetIdentity,
): boolean {
  let binding: HostBinding;
  try {
    binding = bindingFor(identity);
  } catch {
    return false;
  }
  return (
    request.windowId === identity.window.windowId &&
    request.targetProcessId === identity.windowInstance.processId &&
    request.targetProcessStartedAt === identity.windowInstance.processStartedAt &&
    canonicalExecutablePath(request.targetExecutablePath) ===
      canonicalExecutablePath(binding.targetPath) &&
    request.hostWindowId === binding.host.instance.windowId &&
    request.hostProcessId === binding.host.instance.processId &&
    request.hostProcessStartedAt === binding.host.instance.processStartedAt &&
    canonicalExecutablePath(request.hostExecutablePath) ===
      canonicalExecutablePath(binding.host.executablePath)
  );
}

export function publicGrant(grant: DesktopAppGrantRecord): DesktopAppGrant & { createdBy: string } {
  return {
    id: grant.id,
    executablePath: grant.executablePath,
    displayName: grant.displayName,
    createdAt: grant.createdAt,
    ...(grant.sessionId ? { sessionId: grant.sessionId } : {}),
    createdBy: grant.createdBy,
  };
}

export { bindingFor, executablePath };
