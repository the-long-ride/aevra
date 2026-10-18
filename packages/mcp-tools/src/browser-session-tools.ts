import type { BrowserOriginClass, BrowserTabInfo } from '../../protocol/src/browser.js';
import type { RiskTier } from '../../protocol/src/index.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import { classifyOrigin, type OriginPolicyConfig } from '../../browser/src/origin-policy.js';
import { authorizeHostControl, requireHostControlIdentity } from './host-control-gate.js';
import { resetVisited } from './browser-risk.js';
import { AevraToolError } from './errors.js';
import type { McpRuntimeContext } from './service-types.js';

export async function run(
  context: McpRuntimeContext,
  sessionId: string,
  operation: WorkerOperation,
) {
  const identity = requireHostControlIdentity(context, sessionId, 'browser.control');
  const result = await context.worker.execute({
    sessionId,
    workspaceId: '',
    scope: { kind: 'host-control', capability: 'browser.control', identity },
    roots: [],
    operation,
    executionMode: 'host',
  });
  if (!result.ok) {
    throw new AevraToolError(result.error.code, result.error.message, result.error.details);
  }
  return result.value as any;
}

/** Origin of the tab an operation will land on, resolved before the operation runs. */
export async function targetTab(
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

export function audit(
  context: McpRuntimeContext,
  sessionId: string,
  tool: string,
  origin: string,
  risk: RiskTier,
  result: string,
  redactionCount = 0,
) {
  context.deps.audit?.append({
    sessionId,

    tool,
    operation: tool.replace('browser_', 'browser:').replace('_many', ''),
    target: origin,
    risk,
    result,
    redactionCount,
  });
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export async function sessionTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  const pairing = context.deps.browserPairing;
  const risk: RiskTier = name === 'browser_connect' ? 'MEDIUM' : 'LOW';
  const gate = await authorizeHostControl(
    context,
    sessionId,
    'browser.control',
    name,
    args,
    `browser:${name === 'browser_connect' ? 'connect' : 'disconnect'}`,
    risk,
  );
  if ('response' in gate) return gate.response;
  const paired = pairing?.pairedExtensionId();
  const configuredPort = Number(context.deps.settings?.get('browser.cdpPort', 9222) ?? 9222);
  if (name === 'browser_connect' && args.transport === 'cdp') {
    const policy = context.deps.browserPolicy?.snapshot?.();
    if (
      !Number.isInteger(configuredPort) ||
      configuredPort < 1 ||
      configuredPort > 65535 ||
      (args.cdpPort !== undefined && Number(args.cdpPort) !== configuredPort) ||
      policy?.aevraPorts?.includes(configuredPort)
    )
      throw new AevraToolError(
        'INVALID_REQUEST',
        'CDP port must match the operator configured browser.cdpPort',
      );
    args = { ...args, cdpPort: configuredPort };
  }
  const operation: WorkerOperation =
    name === 'browser_connect'
      ? {
          kind: 'browser.connect',
          transport: args.transport === 'cdp' ? 'cdp' : 'extension',
          ...(args.cdpPort === undefined ? {} : { cdpPort: Number(args.cdpPort) }),
          ...(args.tabId === undefined ? {} : { tabId: String(args.tabId) }),
          ...(pairing ? { epoch: pairing.epoch() } : {}),
          ...(pairing ? { pairings: pairing.workerPairings?.() ?? [] } : {}),
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
