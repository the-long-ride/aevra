import { createHash } from 'node:crypto';
import type {
  DesktopCaptureResult,
  DesktopDescribeResult,
  DesktopWindowIdentity,
  DesktopTargetIdentity,
  DetectedApp,
  DesktopCatalogApp,
} from '../../protocol/src/desktop.js';
import type { RiskTier } from '../../protocol/src/index.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import { markUntrusted } from '../../security/src/untrusted.js';
import {
  basename,
  canonicalExecutablePath,
  evaluateDesktopTargetGate,
  evaluateWindowGate,
  isProtectedDesktopTitle,
} from '../../security/src/window-gate.js';
import { authorizeCapability } from './authorization.js';
import { ACT_OP, desktopActRisk, handleAct, sanitizeArgsForAuthorization } from './desktop-act.js';
import {
  BACKGROUND_ACT_OP,
  backgroundActRisk,
  handleBackgroundAction,
} from './desktop-background.js';
import {
  audit,
  policyFor,
  redact,
  redactNode,
  redactWindow,
  run,
  sanitizeDesktopToolError,
  targetOf,
} from './desktop-support.js';
import { AevraToolError } from './errors.js';
import { requiredLease } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export const DESKTOP_TOOL_NAMES = new Set([
  'desktop_status',
  'desktop_connect',
  'desktop_disconnect',
  'desktop_apps',
  'desktop_request_access',
  'desktop_windows',
  'desktop_describe',
  'desktop_capture',
  'desktop_click',
  'desktop_type',
  'desktop_key',
  'desktop_scroll',
  'desktop_invoke',
  'desktop_set_value',
  'desktop_select',
  'desktop_toggle',
  'desktop_release_window',
]);

// A screenshot's `window` field, and every accessible name/title, is
// attacker-controlled text (see the DLP redaction in `desktop-support`), so
// all three read tools (`desktop_windows`, `desktop_describe`,
// `desktop_capture`) mark their result `markUntrusted` - the same reasoning
// `browser_tools` applies to `browser_snapshot` regardless of its mode.

async function handleWindows(context: McpRuntimeContext, sessionId: string, risk: RiskTier) {
  const raw = (await run(context, sessionId, {
    kind: 'desktop.windows',
  })) as DesktopWindowIdentity[];
  const policy = policyFor(context, sessionId);
  const tally = { count: 0 };
  const windows = raw.map((w) => redactWindow(w, tally, policy));
  audit(context, sessionId, 'desktop_windows', `${windows.length} windows`, risk, 'SUCCEEDED', {
    redactionCount: tally.count,
  });
  return markUntrusted({ result: windows });
}

/**
 * Minimal, opt-in app inventory for the model. In denylist ('whole device')
 * mode there is no curated scope to report, so this never enumerates
 * installed apps at all - a whole-device configuration must not leak a
 * large local inventory. In allowlist mode it resolves each configured exe
 * against a fresh detection pass for display name and version, falling back
 * to the raw exe basename for an entry detection did not find (e.g. a
 * portable app with no registry entry) so nothing in the policy silently
 * disappears from what the model is told.
 */
async function handleApps(context: McpRuntimeContext, sessionId: string, risk: RiskTier) {
  const policy = policyFor(context, sessionId);
  if (policy.mode !== 'allowlist') {
    audit(context, sessionId, 'desktop_apps', 'no-scope-configured', risk, 'SUCCEEDED');
    return markUntrusted({
      apps: [],
      note: 'No app scope is configured; desktop control is not restricted to specific apps.',
    });
  }
  const catalog = context.deps.desktopAppCatalog
    ? await context.deps.desktopAppCatalog.list()
    : undefined;
  const detected: DesktopCatalogApp[] = catalog
    ? catalog.apps
    : ((await run(context, sessionId, { kind: 'desktop.apps' })) as DetectedApp[]).map((app) => ({
        displayName: app.displayName,
        version: app.version,
        executablePath: app.executablePath,
        exeBasename: app.exeBasename,
        sources: [],
        grantable: true,
      }));
  const byBasename = new Map<string, DesktopCatalogApp[]>();
  for (const app of detected) {
    if (!app.exeBasename) continue;
    const key = app.exeBasename.toLowerCase();
    byBasename.set(key, [...(byBasename.get(key) ?? []), app]);
  }
  // Every field below is OS-reported text that some installer chose, so it
  // gets the same DLP scan `redactWindow` applies to a window's title and
  // executablePath - a registry DisplayName is exactly as capable of
  // embedding a secret-shaped string as a page-set window title is, and an
  // exposed install path more so.
  const tally = { count: 0 };
  const apps: Array<{ name: string; version: string | null; executablePath?: string }> = [];
  const representedPaths = new Set<string>();
  const legacyRules = new Set(policy.applications.map((entry) => entry.toLowerCase()));
  for (const exeBasename of policy.applications) {
    const matches = byBasename.get(exeBasename.toLowerCase()) ?? [];
    if (matches.length === 0) {
      apps.push({ name: redact(exeBasename, tally) ?? exeBasename, version: null });
      continue;
    }
    for (const found of matches) {
      const version = found.version ? (redact(found.version, tally) ?? null) : null;
      if (found.executablePath) representedPaths.add(canonicalExecutablePath(found.executablePath));
      apps.push({
        name: redact(found.displayName, tally) ?? found.displayName,
        version,
        ...(policy.exposeExecutablePaths && found.executablePath
          ? { executablePath: redact(found.executablePath, tally) }
          : {}),
      });
    }
  }
  for (const grant of policy.appGrants ?? []) {
    // A legacy basename rule already represents every matching executable,
    // including a path grant for one of those same processes.
    if (legacyRules.has(basename(grant.executablePath).toLowerCase())) continue;
    const pathKey = canonicalExecutablePath(grant.executablePath);
    if (representedPaths.has(pathKey)) continue;
    representedPaths.add(pathKey);
    const found = detected.find((app) =>
      app.executablePath && canonicalExecutablePath(app.executablePath) === pathKey,
    );
    const displayName = found?.displayName ?? grant.displayName;
    const version = found?.version ? (redact(found.version, tally) ?? null) : null;
    apps.push({
      name: redact(displayName, tally) ?? displayName,
      version,
      ...(policy.exposeExecutablePaths && (found?.executablePath ?? grant.executablePath)
        ? { executablePath: redact(grant.executablePath, tally) }
        : {}),
    });
  }
  audit(context, sessionId, 'desktop_apps', `${apps.length} apps`, risk, 'SUCCEEDED', {
    redactionCount: tally.count,
  });
  return markUntrusted({ apps });
}

async function handleDescribe(
  context: McpRuntimeContext,
  sessionId: string,
  args: any,
  risk: RiskTier,
) {
  const mode = args.mode === 'background' ? 'background' : 'foreground';
  const policy = policyFor(context, sessionId);
  const operation: WorkerOperation = {
    kind: 'desktop.describe',
    ...(args.windowId !== undefined ? { windowId: String(args.windowId) } : {}),
    maxNodes: Number(args.maxNodes ?? 500),
    interactiveOnly: Boolean(args.interactiveOnly ?? false),
    mode,
    policy,
  };
  let value: DesktopDescribeResult;
  try {
    value = (await run(context, sessionId, operation)) as DesktopDescribeResult;
  } catch (error) {
    throw sanitizeDesktopToolError(context, sessionId, error);
  }
  const tally = { count: 0 };
  const window = redactWindow(value.window, tally, policy);
  const nodes = value.nodes.map((node) => redactNode(node, tally));
  // The worker never gates reads, so without this call the gate's capture
  // branch is unreachable and every screenshot/describe would be missing
  // from the audit trail - see the brief's requirement 4.
  const verdict = evaluateWindowGate(
    value.window,
    policy,
    mode === 'background' ? 'background' : 'capture',
  );
  audit(context, sessionId, 'desktop_describe', targetOf(window), risk, 'SUCCEEDED', {
    redactionCount: tally.count,
    gateVerdict: verdict.allowed ? 'allow' : 'deny',
    gateRule: verdict.reason,
  });
  return markUntrusted({
    window,
    nodes,
    truncated: value.truncated,
    ...(value.snapshotId ? { snapshotId: value.snapshotId } : {}),
    ...(value.windowLeaseId ? { windowLeaseId: value.windowLeaseId } : {}),
    ...(value.leaseExpiresAt ? { leaseExpiresAt: value.leaseExpiresAt } : {}),
  });
}

async function handleCapture(
  context: McpRuntimeContext,
  sessionId: string,
  args: any,
  risk: RiskTier,
) {
  const operation: WorkerOperation = {
    kind: 'desktop.capture',
    ...(args.windowId !== undefined ? { windowId: String(args.windowId) } : {}),
  };
  const value = (await run(context, sessionId, operation)) as DesktopCaptureResult;
  const policy = policyFor(context, sessionId);
  const tally = { count: 0 };
  const window = value.window ? redactWindow(value.window, tally, policy) : null;
  // An unattributable window (null here) is the one interesting read
  // verdict - capture is always allowed regardless of attribution, but that
  // is itself a gate decision worth an audit row, not a reason to skip the
  // gate call entirely. A synthetic identity with no processName/
  // executablePath is exactly what `evaluateWindowGate` already treats as
  // "unattributable", so no special-casing is needed beyond supplying one.
  const gateIdentity: DesktopWindowIdentity = window ?? { windowId: 'unattributable' };
  const verdict = evaluateWindowGate(gateIdentity, policy, 'capture');
  // Screenshots are pixels and cannot be DLP-redacted, so the audit log
  // records a content hash of the image, never `imageDataUri` itself.
  const evidence = `${targetOf(window)} sha256:${createHash('sha256')
    .update(String(value.imageDataUri))
    .digest('hex')}`;
  audit(context, sessionId, 'desktop_capture', evidence, risk, 'SUCCEEDED', {
    redactionCount: tally.count,
    gateVerdict: verdict.allowed ? 'allow' : 'deny',
    gateRule: verdict.reason,
  });
  return markUntrusted({
    imageDataUri: value.imageDataUri,
    devicePixelRatio: value.devicePixelRatio,
    window,
  });
}

/**
 * Reads are LOW, `desktop_connect` is MEDIUM, and input is priced by
 * `desktopActRisk` - see there for why input is no longer uniformly LOW.
 */
function riskFor(name: string): RiskTier {
  if (name === 'desktop_connect') return 'MEDIUM';
  if (name === 'desktop_request_access') return 'LOW';
  if (ACT_OP[name]) return desktopActRisk(name);
  if (BACKGROUND_ACT_OP[name] || name === 'desktop_release_window') return backgroundActRisk(name);
  return 'LOW';
}

export async function handleDesktopTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  if (!DESKTOP_TOOL_NAMES.has(name)) {
    throw new AevraToolError('CAPABILITY_REQUIRED', `Tool ${name} is not enabled`);
  }
  const risk = riskFor(name);
  const gate = await authorizeCapability(
    context,
    sessionId,
    'desktop.control',
    { tool: name, args: sanitizeArgsForAuthorization(name, args) },
    `desktop:${name.replace('desktop_', '')}`,
    risk,
  );
  if ('response' in gate) return gate.response;

  if (name === 'desktop_status' || name === 'desktop_connect' || name === 'desktop_disconnect') {
    const kind = name.replace('desktop_', 'desktop.') as
      'desktop.status' | 'desktop.connect' | 'desktop.disconnect';
    const value = await run(context, sessionId, { kind });
    audit(context, sessionId, name, 'session', risk, 'SUCCEEDED');
    return value;
  }
  if (name === 'desktop_windows') return handleWindows(context, sessionId, risk);
  if (name === 'desktop_apps') return handleApps(context, sessionId, risk);
  if (name === 'desktop_request_access') {
    if (!context.deps.desktopAccess) {
      throw new AevraToolError('DESKTOP_UNAVAILABLE', 'Desktop access requests are unavailable');
    }
    const windowId = String(args.windowId ?? '');
    if (!windowId) throw new AevraToolError('INVALID_REQUEST', 'windowId is required');
    if (args.duration !== 'session' && args.duration !== 'persistent') {
      throw new AevraToolError('INVALID_REQUEST', 'duration must be session or persistent');
    }
    const duration = args.duration;
    const identity = (await run(context, sessionId, {
      kind: 'desktop.targetIdentity',
      windowId,
    })) as DesktopTargetIdentity;
    const policy = policyFor(context, sessionId);
    if (isProtectedDesktopTitle(identity.window, policy)) {
      throw new AevraToolError(
        'DESKTOP_ACCESS_REQUEST_UNAVAILABLE',
        'Access requests are unavailable for a protected desktop window.',
      );
    }
    if (policy.mode !== 'allowlist') {
      throw new AevraToolError(
        'DESKTOP_ACCESS_REQUEST_UNAVAILABLE',
        'App access requests are available only when desktop control uses an allowlist.',
      );
    }
    const verdict = evaluateDesktopTargetGate(identity, policy, 'background', sessionId);
    if (verdict.allowed) {
      throw new AevraToolError('DESKTOP_ACCESS_ALREADY_ALLOWED', 'This app already has desktop access.');
    }
    if (verdict.reason.includes('WebView2 host could not be verified')) {
      throw new AevraToolError('DESKTOP_HOST_UNVERIFIED', verdict.reason);
    }
    if (!verdict.reason.includes('refused by allowlist')) {
      throw new AevraToolError('DESKTOP_ACCESS_REQUEST_UNAVAILABLE', verdict.reason);
    }
    const lease = requiredLease(context, sessionId);
    const session = context.sessions.get(sessionId);
    if (!lease || !session) throw new AevraToolError('CAPABILITY_REQUIRED', 'Desktop session is no longer active');
    const result = context.deps.desktopAccess.request({
      actor: session.actor,
      sessionId,
      workspaceId: lease.workspaceId,
      windowId,
      duration,
      identity,
    });
    audit(context, sessionId, name, result.application, risk, 'SUCCEEDED');
    return markUntrusted({ ...result, application: redact(result.application, { count: 0 }) ?? result.application });
  }
  if (name === 'desktop_describe') return handleDescribe(context, sessionId, args, risk);
  if (name === 'desktop_capture') return handleCapture(context, sessionId, args, risk);
  if (BACKGROUND_ACT_OP[name] || name === 'desktop_release_window') {
    return handleBackgroundAction(context, sessionId, name, args, risk);
  }
  return handleAct(context, sessionId, name, args, risk);
}
