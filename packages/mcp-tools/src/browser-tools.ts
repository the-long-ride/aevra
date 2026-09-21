import { createHash } from 'node:crypto';
import type { BrowserOriginClass, BrowserTabInfo } from '../../protocol/src/browser.js';
import type { RiskTier } from '../../protocol/src/index.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import { classifyOrigin } from '../../browser/src/origin-policy.js';
import type { OriginPolicyConfig } from '../../browser/src/origin-policy.js';
import { scanNavigateUrl } from '../../security/src/browser-url-policy.js';
import { markUntrusted } from '../../security/src/untrusted.js';
import { authorizeCapability, gated } from './authorization.js';
import {
  browserOperationRisk,
  isFirstVisit,
  noteVisited,
  refuseBlockedOrigin,
  refuseSensitiveScreenshot,
  resetVisited,
} from './browser-risk.js';
import { browserOperation } from './browser-operations.js';
import { redactBrowserResult, reclassifyOrigins } from './browser-results.js';
import { AevraToolError } from './errors.js';
import { argsHash, requiredLease } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export const BROWSER_TOOL_NAMES = new Set([
  'browser_connect',
  'browser_status',
  'browser_disconnect',
  'browser_tabs',
  'browser_navigate',
  'browser_snapshot',
  'browser_read',
  'browser_act_many',
  'browser_logs',
]);

const UNTRUSTED_RESULTS = new Set([
  'browser_snapshot',
  'browser_read',
  'browser_logs',
  'browser_tabs',
]);

async function run(context: McpRuntimeContext, sessionId: string, operation: WorkerOperation) {
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

/** Origin of the tab an operation will land on, resolved before the operation runs. */
async function targetTab(
  context: McpRuntimeContext,
  sessionId: string,
  tabId?: string,
  policy?: Partial<OriginPolicyConfig>,
): Promise<{ tabId?: string; url: string; originClass: BrowserOriginClass }> {
  const tabs = (await run(context, sessionId, {
    kind: 'browser.tabs',
    action: 'list',
  })) as BrowserTabInfo[];
  const tab = tabId
    ? tabs.find((entry) => entry.tabId === tabId)
    : (tabs.find((entry) => entry.active) ?? tabs[0]);
  if (!tab) {
    throw new AevraToolError('NOT_FOUND', `No browser tab matches ${tabId ?? 'the active tab'}`);
  }
  return { tabId: tab.tabId, url: tab.url, originClass: classifyOrigin(tab.url, policy) };
}

function audit(
  context: McpRuntimeContext,
  sessionId: string,
  tool: string,
  origin: string,
  risk: RiskTier,
  result: string,
  redactionCount = 0,
) {
  const lease = context.workspaceId
    ? context.sessions.leaseForWorkspace(sessionId, context.workspaceId)
    : context.sessions.activeLease(sessionId);
  context.deps.audit?.append({
    sessionId,
    ...(lease ? { workspaceId: lease.workspaceId } : {}),
    tool,
    operation: tool.replace('browser_', 'browser:').replace('_many', ''),
    target: origin,
    risk,
    result,
    redactionCount,
  });
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

async function sessionTool(context: McpRuntimeContext, sessionId: string, name: string, args: any) {
  const pairing = context.deps.browserPairing;
  const risk: RiskTier = name === 'browser_connect' ? 'MEDIUM' : 'LOW';
  const gate = await authorizeCapability(
    context,
    sessionId,
    'browser.control',
    { tool: name, args },
    `browser:${name === 'browser_connect' ? 'connect' : 'disconnect'}`,
    risk,
  );
  if ('response' in gate) return gate.response;
  const paired = pairing?.pairedExtensionId();
  const operation: WorkerOperation =
    name === 'browser_connect'
      ? {
          kind: 'browser.connect',
          transport: args.transport === 'cdp' ? 'cdp' : 'extension',
          ...(args.cdpPort === undefined ? {} : { cdpPort: Number(args.cdpPort) }),
          ...(args.tabId === undefined ? {} : { tabId: String(args.tabId) }),
          ...(pairing ? { epoch: pairing.epoch() } : {}),
          ...(paired ? { extensionId: paired } : {}),
        }
      : { kind: 'browser.disconnect' };
  const value = await run(context, sessionId, operation);
  // The visit ledger is per-session first-visit state. A session that has let
  // go of the browser should not carry its history into the next attachment.
  if (name === 'browser_disconnect') resetVisited(sessionId);
  audit(context, sessionId, name, args.transport ?? 'session', risk, 'SUCCEEDED');
  return value;
}

export async function handleBrowserTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  if (!BROWSER_TOOL_NAMES.has(name)) {
    throw new AevraToolError('CAPABILITY_REQUIRED', `Tool ${name} is not enabled`);
  }
  const pairing = context.deps.browserPairing;
  // One snapshot per tool call: a settings change mid-call must not make two
  // checks in the same operation disagree.
  const policy = context.deps.browserPolicy?.snapshot();

  if (name === 'browser_status') {
    const gate = await authorizeCapability(
      context,
      sessionId,
      'browser.control',
      { tool: name, args },
      'browser:status',
      'LOW',
    );
    if ('response' in gate) return gate.response;
    // The worker owns the live session; core owns pairing. Status needs both,
    // and must still answer when no browser is attached.
    //
    // Stamping the epoch here is what syncs a freshly started worker: it adopts
    // the first epoch it is told, so a status call is enough and no connect has
    // to happen first.
    const live = (await run(context, sessionId, {
      kind: 'browser.status',
      ...(pairing ? { epoch: pairing.epoch() } : {}),
    })) as {
      connected: boolean;
      transport: string | null;
      tabs: unknown[];
      epoch: number;
    };
    return {
      ...live,
      // Both values, never one masking the other: a worker that disagrees with
      // core refuses every extension socket, and that has to be visible.
      epoch: pairing?.epoch() ?? live.epoch ?? 0,
      workerEpoch: live.epoch ?? 0,
      tabs: reclassifyOrigins(live.tabs, policy),
      extensionPaired: Boolean(pairing?.pairedExtensionId()),
      extensionId: pairing?.pairedExtensionId() ?? null,
    };
  }

  if (name === 'browser_connect' || name === 'browser_disconnect') {
    return sessionTool(context, sessionId, name, args);
  }

  // Every remaining tool acts on a page, so its origin decides the risk tier.
  // Any operation that sends the browser somewhere is a navigation for policy
  // purposes. `browser_tabs {action:'open'}` opens a URL exactly as
  // `browser_navigate` does, and must not skip the origin and DLP checks.
  const navigates =
    name === 'browser_navigate' || (name === 'browser_tabs' && args.action === 'open');
  const navigateUrl = navigates ? String(args.url ?? '') : '';
  if (navigateUrl) {
    refuseBlockedOrigin(navigateUrl, policy);
    const scan = scanNavigateUrl(navigateUrl);
    if (scan.blocked) {
      throw new AevraToolError('BROWSER_ORIGIN_BLOCKED', scan.reason ?? 'Navigation refused');
    }
  }

  // Gate on the capability BEFORE resolving the target tab. Tab resolution is
  // itself a worker call that returns every open tab's URL and title, so doing
  // it first would let a session without browser.control enumerate the user's
  // tabs and only then be refused.
  const entry = await authorizeCapability(
    context,
    sessionId,
    'browser.control',
    { tool: name, args },
    `browser:${name.replace('browser_', '')}`,
    'LOW',
  );
  if ('response' in entry) return entry.response;

  const target = await targetTab(context, sessionId, args.tabId, policy);
  refuseBlockedOrigin(target.url, policy);
  const destination = navigateUrl || target.url;
  const originClass = navigateUrl ? classifyOrigin(navigateUrl, policy) : target.originClass;
  if (name === 'browser_snapshot') {
    refuseSensitiveScreenshot(originClass, String(args.mode ?? 'a11y'));
  }

  const risk = browserOperationRisk({
    tool: name,
    originClass,
    currentOriginClass: target.originClass,
    ...(navigateUrl
      ? {
          navigates: true,
          firstVisit: isFirstVisit(sessionId, navigateUrl),
          crossOrigin: originOf(navigateUrl) !== originOf(target.url),
        }
      : {}),
  });
  const gate = await authorizeCapability(
    context,
    sessionId,
    'browser.control',
    { tool: name, args },
    `browser:${name.replace('browser_', '')}`,
    risk,
  );
  if ('response' in gate) return gate.response;

  const operation = browserOperation(name, args, target.tabId);
  const execute = async () => {
    const value = await run(context, sessionId, operation);
    if (navigateUrl) noteVisited(sessionId, navigateUrl);
    // Screenshots are pixels and cannot be DLP-redacted, so the audit log records
    // a content hash of the image instead of the image itself.
    const evidence = value?.imageDataUri
      ? `${originOf(destination)} sha256:${createHash('sha256')
          .update(String(value.imageDataUri))
          .digest('hex')}`
      : originOf(destination);
    // Restamp before redacting: a redacted URL is no longer classifiable.
    const shaped = reclassifyOrigins(value, policy);
    if (!UNTRUSTED_RESULTS.has(name)) {
      audit(context, sessionId, name, evidence, risk, 'SUCCEEDED');
      return shaped;
    }
    const redacted = redactBrowserResult(shaped);
    audit(context, sessionId, name, evidence, risk, 'SUCCEEDED', redacted.redactionCount);
    return markUntrusted(
      Array.isArray(redacted.value) ? { result: redacted.value } : (redacted.value as object),
    );
  };
  if (risk === 'LOW') return execute();

  return gated(
    context,
    sessionId,
    {
      family: `browser:${name.replace('browser_', '')}`,
      capability: 'browser.control',
      risk,
      argsHash: argsHash({ destination, args }),
    },
    { tool: name, args: { ...args, origin: originOf(destination), originClass } },
    {},
    execute,
  );
}
