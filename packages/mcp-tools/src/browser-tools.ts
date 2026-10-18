import { run, targetTab, audit, originOf, sessionTool } from './browser-session-tools.js';
import { createHash } from 'node:crypto';
import { classifyOrigin } from '../../browser/src/origin-policy.js';
import { scanNavigateUrl } from '../../security/src/browser-url-policy.js';
import { markUntrusted } from '../../security/src/untrusted.js';
import { authorizeHostControl, gatedHostControl } from './host-control-gate.js';
import {
  browserOperationRisk,
  isFirstVisit,
  noteVisited,
  refuseBlockedOrigin,
  refuseSensitiveScreenshot,
} from './browser-risk.js';
import { browserOperation } from './browser-operations.js';
import { browserApprovalBinding } from './browser-approval-binding.js';
import { redactBrowserResult, reclassifyOrigins, UNTRUSTED_RESULTS } from './browser-results.js';
import { AevraToolError } from './errors.js';
import { argsHash } from './service-helpers.js';
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
  'browser_execute_script',
  'browser_logs',
]);

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
    const gate = await authorizeHostControl(
      context,
      sessionId,
      'browser.control',
      name,
      args,
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
    const health = await pairing?.pairingHealth?.();
    const live = health
      ? health.worker
      : ((await run(context, sessionId, {
          kind: 'browser.status',
          ...(pairing
            ? {
                epoch: pairing.epoch(),
                extensionId: pairing.pairedExtensionId() ?? '',
                pairings: pairing.workerPairings?.() ?? [],
              }
            : {}),
        })) as any);
    const extensionPaired = Boolean(pairing?.pairedExtensionId());
    const connectionState = live?.connected
      ? 'attached'
      : health && !live
        ? 'worker_unavailable'
        : live?.listener?.state === 'failed'
          ? 'listener_failed'
          : !extensionPaired
            ? 'not_paired'
            : live?.extensionSocketAuthenticated
              ? 'ready_to_connect'
              : 'waiting_for_extension';
    return {
      ...(live ?? {
        connected: false,
        transport: null,
        tabs: [],
        extensionSocketAuthenticated: false,
      }),
      epoch: pairing?.epoch() ?? live?.epoch ?? 0,
      workerEpoch: live?.workerEpoch ?? live?.epoch ?? 0,
      tabs: reclassifyOrigins(live?.tabs ?? [], policy),
      extensionPaired,
      connectionState,
      nextAction:
        connectionState === 'ready_to_connect'
          ? { tool: 'browser_connect', arguments: { transport: 'extension' } }
          : null,
      extensionId: pairing?.pairedExtensionId() ?? null,
      coreExtensionId: health?.coreExtensionId ?? pairing?.pairedExtensionId() ?? null,
      coreEpoch: health?.coreEpoch ?? pairing?.epoch() ?? 0,
      listener: live?.listener ?? null,
      extensionSocketAuthenticated: live?.extensionSocketAuthenticated ?? false,
      extensionCredentialState: !pairing?.pairedExtensionId()
        ? 'absent'
        : live?.extensionSocketAuthenticated
          ? 'accepted'
          : 'unknown',
      workerExtensionId: live?.workerExtensionId ?? null,
      syncErrorCode: health?.syncErrorCode ?? null,
      syncCheckedAt: health?.syncCheckedAt ?? null,
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
  const entry = await authorizeHostControl(
    context,
    sessionId,
    'browser.control',
    name,
    args,
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

  // Pure request validation belongs before MEDIUM/HIGH approval creation so
  // malformed scripts, oversized waits, and secret-shaped outbound values do
  // not enter approval payloads or UI surfaces.
  const operation = browserOperation(name, args, target.tabId);
  if (
    ['browser.act', 'browser.snapshot', 'browser.read', 'browser.logs'].includes(operation.kind)
  ) {
    (operation as any).expectedUrl = target.url;
    (operation as any).originPolicy = policy;
  }

  const gate = await authorizeHostControl(
    context,
    sessionId,
    'browser.control',
    name,
    args,
    `browser:${name.replace('browser_', '')}`,
    risk,
  );
  if ('response' in gate) return gate.response;

  const execute = async () => {
    const value = await run(context, sessionId, operation);
    if (value?.url && ['browser.snapshot', 'browser.read'].includes(operation.kind)) {
      refuseBlockedOrigin(value.url, policy);
      if (value.url !== target.url)
        throw new AevraToolError('BROWSER_ORIGIN_BLOCKED', 'Browser document changed during read');
      if (name === 'browser_snapshot')
        refuseSensitiveScreenshot(classifyOrigin(value.url, policy), String(args.mode ?? 'a11y'));
    }
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
  if (risk === 'LOW' && !context.hostApprovalProof) return execute();

  const browserBinding = browserApprovalBinding(
    await run(context, sessionId, { kind: 'browser.status' }),
    target.tabId,
    target.url,
  );
  const approvalArgs = { ...args, tabId: target.tabId };

  return gatedHostControl(
    context,
    sessionId,
    {
      family: `browser:${name.replace('browser_', '')}`,
      capability: 'browser.control',
      risk,
      argsHash: argsHash({ destination, args: approvalArgs }),
    },
    {
      tool: name,
      args: { ...approvalArgs, origin: originOf(destination), originClass },
      browserBinding,
    },
    execute,
  );
}
