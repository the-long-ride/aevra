import { randomUUID } from 'node:crypto';
import type { BackgroundActionInput, DesktopWindowIdentity } from '../../protocol/src/desktop.js';
import type { RiskTier } from '../../protocol/src/index.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import { markUntrusted } from '../../security/src/untrusted.js';
import { gated } from './authorization.js';
import { audit, policyFor, run, targetOf } from './desktop-support.js';
import { asToolError } from './errors.js';
import { argsHash } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export const BACKGROUND_ACT_OP: Record<string, 'invoke' | 'setValue' | 'select' | 'toggle'> = {
  desktop_invoke: 'invoke',
  desktop_set_value: 'setValue',
  desktop_select: 'select',
  desktop_toggle: 'toggle',
};

export function backgroundActRisk(name: string): RiskTier {
  if (name === 'desktop_set_value') return 'HIGH';
  if (name === 'desktop_release_window') return 'LOW';
  return 'MEDIUM';
}

export function sanitizeBackgroundArgs(name: string, args: any): any {
  if (name === 'desktop_set_value' && typeof args?.value === 'string') {
    const { value, ...rest } = args;
    const requestNonce = args.requestNonce ?? randomUUID();
    return { ...rest, valueLength: value.length, requestNonce };
  }
  return args;
}

export async function handleBackgroundAction(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
  risk: RiskTier,
) {
  if (name === 'desktop_release_window') {
    const operation: WorkerOperation = {
      kind: 'desktop.releaseWindow',
      windowId: String(args.windowId ?? ''),
      windowLeaseId: String(args.windowLeaseId ?? ''),
    };
    const target = `window:${args.windowId}`;
    try {
      const result = await run(context, sessionId, operation);
      audit(context, sessionId, name, target, risk, 'SUCCEEDED');
      return markUntrusted(result);
    } catch (error) {
      const err = asToolError(error);
      audit(context, sessionId, name, target, risk, 'FAILED');
      throw err;
    }
  }

  const op = BACKGROUND_ACT_OP[name];
  if (!op) {
    throw asToolError(new Error(`Unknown background desktop operation: ${name}`));
  }

  const safeArgs = sanitizeBackgroundArgs(name, args);
  // Persist requestNonce back to args in memory so resumption matches
  if (safeArgs.requestNonce && !args.requestNonce) {
    args.requestNonce = safeArgs.requestNonce;
  }

  const windowId = String(args.windowId ?? '');
  const windowLeaseId = String(args.windowLeaseId ?? '');
  const snapshotId = String(args.snapshotId ?? '');
  const ref = String(args.ref ?? '');

  const actionInput: BackgroundActionInput =
    op === 'setValue'
      ? {
          windowId,
          windowLeaseId,
          snapshotId,
          ref,
          op: 'setValue',
          value: String(args.value ?? ''),
        }
      : {
          windowId,
          windowLeaseId,
          snapshotId,
          ref,
          op,
        };

  const operation: WorkerOperation = {
    kind: 'desktop.backgroundAct',
    action: actionInput,
    policy: policyFor(context),
  };

  const target = `${windowId}:${ref}`;
  const auditTarget =
    op === 'setValue' ? `${target} (${String(args.value ?? '').length} chars)` : target;

  const execute = async () => {
    try {
      const result = (await run(context, sessionId, operation)) as any;
      const window: DesktopWindowIdentity | undefined = result?.window;
      audit(context, sessionId, name, auditTarget, risk, 'SUCCEEDED', {
        window: targetOf(window),
        ...(result?.gateVerdict
          ? { gateVerdict: result.gateVerdict, gateRule: result.gateRule }
          : {}),
      });
      return markUntrusted(result);
    } catch (error) {
      const err = asToolError(error);
      const details = err.details as
        | { window?: DesktopWindowIdentity; gateVerdict?: 'allow' | 'deny'; gateRule?: string }
        | undefined;
      audit(context, sessionId, name, auditTarget, risk, 'FAILED', {
        ...(details?.window ? { window: targetOf(details.window) } : {}),
        ...(details?.gateVerdict
          ? { gateVerdict: details.gateVerdict, gateRule: details.gateRule }
          : {}),
      });
      throw err;
    }
  };

  return gated(
    context,
    sessionId,
    {
      family: `desktop:${op}`,
      capability: 'desktop.control',
      risk,
      argsHash: argsHash({ target, args: safeArgs }),
    },
    { tool: name, args: safeArgs },
    {
      windowId,
      windowLeaseId,
      snapshotId,
      ...(safeArgs.requestNonce ? { requestNonce: safeArgs.requestNonce } : {}),
    },
    execute,
  );
}
