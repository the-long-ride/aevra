import type {
  DesktopNode,
  DesktopPolicy,
  DesktopWindowIdentity,
} from '../../protocol/src/desktop.js';
import type { RiskTier } from '../../protocol/src/index.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import { defaultDesktopPolicy } from '../../security/src/desktop-policy-defaults.js';
import { redactText } from '../../security/src/dlp.js';
import { basename } from '../../security/src/window-gate.js';
import { AevraToolError } from './errors.js';
import { requiredLease } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export async function run(
  context: McpRuntimeContext,
  sessionId: string,
  operation: WorkerOperation,
) {
  const lease = requiredLease(context, sessionId);
  const result = await context.worker.execute({
    sessionId,
    workspaceId: lease.workspaceId,
    roots: context.workspaces.capabilityRoots(lease.workspaceId),
    operation,
    executionMode: 'host',
  });
  if (!result.ok) {
    throw new AevraToolError(result.error.code, result.error.message, result.error.details);
  }
  return result.value as any;
}

export function audit(
  context: McpRuntimeContext,
  sessionId: string,
  tool: string,
  target: string,
  risk: RiskTier,
  result: 'SUCCEEDED' | 'FAILED',
  extra: {
    redactionCount?: number;
    gateVerdict?: 'allow' | 'deny';
    gateRule?: string;
    window?: string;
  } = {},
) {
  const lease = context.workspaceId
    ? context.sessions.leaseForWorkspace(sessionId, context.workspaceId)
    : context.sessions.activeLease(sessionId);
  context.deps.audit?.append({
    sessionId,
    ...(lease ? { workspaceId: lease.workspaceId } : {}),
    tool,
    operation: tool.replace('desktop_', 'desktop:'),
    target,
    risk,
    result,
    redactionCount: extra.redactionCount ?? 0,
    ...(extra.window ? { window: extra.window } : {}),
    ...(extra.gateVerdict ? { gateVerdict: extra.gateVerdict, gateRule: extra.gateRule } : {}),
  });
}

// Policy comes from workspace settings when a session provides that generic
// mechanism (see `McpToolDependencies.settings`, already used by
// `HookService`); otherwise the hard-coded default applies unconditionally.
// There is no dedicated desktop-policy config subsystem in this repo, and
// this task does not invent one.
//
// A stored value is untrusted input (it round-trips through settings, which
// something other than this code can write) and must be validated before
// use: a policy missing `applications` makes `matches()` in the gate throw a
// bare TypeError deep inside a security check, and a policy that is present
// but shaped wrong (e.g. only `{ unattributedInput: 'allow' }`) would
// silently replace every field of the real default, including the denylist,
// rather than merging with it. Fail closed: anything that does not look like
// a complete `DesktopPolicy` falls back to `defaultDesktopPolicy()` outright,
// as a refusal to trust the value rather than a crash.
export function isValidDesktopPolicy(value: unknown): value is DesktopPolicy {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<DesktopPolicy>;
  if (p.mode !== 'allowlist' && p.mode !== 'denylist') return false;
  if (!Array.isArray(p.applications) || !p.applications.every((a) => typeof a === 'string')) {
    return false;
  }
  if (p.exposeExecutablePaths !== undefined && typeof p.exposeExecutablePaths !== 'boolean') {
    return false;
  }
  if (p.unattributedInput !== 'allow' && p.unattributedInput !== 'deny') return false;
  if (
    p.deniedTitlePatterns !== undefined &&
    (!Array.isArray(p.deniedTitlePatterns) ||
      !p.deniedTitlePatterns.every((t) => typeof t === 'string'))
  ) {
    return false;
  }
  return true;
}

export function policyFor(context: McpRuntimeContext): DesktopPolicy {
  const stored = context.deps.settings?.get<unknown>('desktop.policy', defaultDesktopPolicy());
  return isValidDesktopPolicy(stored) ? stored : defaultDesktopPolicy();
}

export function redact(text: string | undefined, tally: { count: number }): string | undefined {
  if (text === undefined) return text;
  const scanned = redactText(text);
  tally.count += scanned.redactionCount;
  return scanned.text;
}

export function redactWindow(
  window: DesktopWindowIdentity,
  tally: { count: number },
  policy: DesktopPolicy,
): DesktopWindowIdentity {
  // Collapsing to the basename happens BEFORE the DLP scan, per policy: an
  // operator who has not opted into full paths should never see one appear
  // in the model's context, regardless of whether it happens to contain
  // anything DLP would have flagged anyway. `evaluateWindowGate` is always
  // called with the RAW window identity (see every call site in
  // desktop-tools.ts), so this narrowing can never weaken a gate decision -
  // it only changes what gets serialized back to the model.
  const executablePath =
    !policy.exposeExecutablePaths && window.executablePath
      ? basename(window.executablePath)
      : window.executablePath;
  return {
    ...window,
    title: redact(window.title, tally),
    executablePath: redact(executablePath, tally),
  };
}

export function redactNode(node: DesktopNode, tally: { count: number }): DesktopNode {
  return {
    ...node,
    name: redact(node.name, tally) ?? node.name,
    ...(node.value !== undefined ? { value: redact(node.value, tally) } : {}),
    ...(node.children ? { children: node.children.map((child) => redactNode(child, tally)) } : {}),
  };
}

export function targetOf(window: DesktopWindowIdentity | null | undefined): string {
  return window?.processName ?? window?.executablePath ?? 'unknown-window';
}
