import { createHash } from 'node:crypto';
import type {
  DesktopCaptureResult,
  DesktopDescribeResult,
  DesktopWindowIdentity,
  DetectedApp,
} from '../../protocol/src/desktop.js';
import type { RiskTier } from '../../protocol/src/index.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import { markUntrusted } from '../../security/src/untrusted.js';
import { evaluateWindowGate } from '../../security/src/window-gate.js';
import { authorizeCapability } from './authorization.js';
import { ACT_OP, desktopActRisk, handleAct, sanitizeArgsForAuthorization } from './desktop-act.js';
import {
  audit,
  policyFor,
  redact,
  redactNode,
  redactWindow,
  run,
  targetOf,
} from './desktop-support.js';
import { AevraToolError } from './errors.js';
import type { McpRuntimeContext } from './service-types.js';

export const DESKTOP_TOOL_NAMES = new Set([
  'desktop_status',
  'desktop_connect',
  'desktop_disconnect',
  'desktop_apps',
  'desktop_windows',
  'desktop_describe',
  'desktop_capture',
  'desktop_click',
  'desktop_type',
  'desktop_key',
  'desktop_scroll',
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
  const policy = policyFor(context);
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
  const policy = policyFor(context);
  if (policy.mode !== 'allowlist') {
    audit(context, sessionId, 'desktop_apps', 'no-scope-configured', risk, 'SUCCEEDED');
    return markUntrusted({
      apps: [],
      note: 'No app scope is configured; desktop control is not restricted to specific apps.',
    });
  }
  const detected = (await run(context, sessionId, { kind: 'desktop.apps' })) as DetectedApp[];
  const byBasename = new Map(detected.map((app) => [app.exeBasename.toLowerCase(), app]));
  // Every field below is OS-reported text that some installer chose, so it
  // gets the same DLP scan `redactWindow` applies to a window's title and
  // executablePath - a registry DisplayName is exactly as capable of
  // embedding a secret-shaped string as a page-set window title is, and an
  // exposed install path more so.
  const tally = { count: 0 };
  const apps = policy.applications.map((exeBasename) => {
    const found = byBasename.get(exeBasename.toLowerCase());
    const version = found?.version ? (redact(found.version, tally) ?? null) : null;
    return {
      name: redact(found?.displayName ?? exeBasename, tally) ?? exeBasename,
      version,
      ...(policy.exposeExecutablePaths && found
        ? { executablePath: redact(found.executablePath, tally) }
        : {}),
    };
  });
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
  const operation: WorkerOperation = {
    kind: 'desktop.describe',
    ...(args.windowId !== undefined ? { windowId: String(args.windowId) } : {}),
    maxNodes: Number(args.maxNodes ?? 500),
    interactiveOnly: Boolean(args.interactiveOnly ?? false),
  };
  const value = (await run(context, sessionId, operation)) as DesktopDescribeResult;
  const policy = policyFor(context);
  const tally = { count: 0 };
  const window = redactWindow(value.window, tally, policy);
  const nodes = value.nodes.map((node) => redactNode(node, tally));
  // The worker never gates reads, so without this call the gate's capture
  // branch is unreachable and every screenshot/describe would be missing
  // from the audit trail - see the brief's requirement 4.
  const verdict = evaluateWindowGate(value.window, policy, 'capture');
  audit(context, sessionId, 'desktop_describe', targetOf(window), risk, 'SUCCEEDED', {
    redactionCount: tally.count,
    gateVerdict: verdict.allowed ? 'allow' : 'deny',
    gateRule: verdict.reason,
  });
  return markUntrusted({ window, nodes, truncated: value.truncated });
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
  const policy = policyFor(context);
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
  return ACT_OP[name] ? desktopActRisk(name) : 'LOW';
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
  if (name === 'desktop_describe') return handleDescribe(context, sessionId, args, risk);
  if (name === 'desktop_capture') return handleCapture(context, sessionId, args, risk);
  return handleAct(context, sessionId, name, args, risk);
}
