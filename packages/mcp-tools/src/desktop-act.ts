import { randomUUID } from 'node:crypto';
import type { DesktopWindowIdentity } from '../../protocol/src/desktop.js';
import type { RiskTier } from '../../protocol/src/index.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import { gated } from './authorization.js';
import { audit, policyFor, run, targetOf } from './desktop-support.js';
import { asToolError } from './errors.js';
import { argsHash } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export const ACT_OP: Record<string, 'click' | 'type' | 'key' | 'scroll'> = {
  desktop_click: 'click',
  desktop_type: 'type',
  desktop_key: 'key',
  desktop_scroll: 'scroll',
};

/**
 * What one desktop input action is worth on the approval scale.
 *
 * These used to all be LOW, which meant `gated()` short-circuits and no
 * desktop input ever prompted: once `desktop.control` was leased, an agent
 * could click and type anywhere the window gate permitted, unattended, for
 * the life of the lease. The window gate answers "which window may receive
 * this", never "should this happen at all", and a denylist of processes
 * cannot cover the case that matters most - a browser or an editor is exactly
 * what a desktop agent needs to drive, and either one reaches a shell, an
 * address bar, or Aevra's own admin UI from inside a permitted process.
 *
 * - `scroll` stays LOW. It moves a viewport and nothing else; approving every
 *   scroll would train people to approve everything.
 * - `click` is MEDIUM. A single click submits, sends, deletes, or confirms,
 *   and nothing at this layer can tell which.
 * - `type` and `key` are HIGH. Typed text reaches whatever has focus, and a
 *   key sequence is strictly more capable than a click: chords drive menus,
 *   switch tabs, and spell out anything a `type` could have sent.
 */
export function desktopActRisk(name: string): RiskTier {
  const op = ACT_OP[name];
  if (op === 'scroll') return 'LOW';
  if (op === 'click') return 'MEDIUM';
  return 'HIGH';
}

// `desktop_type`'s `text` and `desktop_key`'s `keys` must never reach the
// authorization layer: on the branch where the capability is not already
// leased, `authorizeCapability` persists its `original` argument verbatim
// into `pending_approvals` via the approval repository, and
// `sanitizeStructuredSecrets` redacts by KEY NAME
// (token|secret|password|credential|...) plus an entropy heuristic - neither
// `text` nor `keys` matches that, so a passphrase typed via `desktop_type`,
// or spelled out one keystroke at a time via `desktop_key`, would otherwise
// be written to disk in the clear. `keys` is exactly as sensitive as `text`
// here: nothing stops a caller from sending a password as a sequence of
// single-character chords instead of one `desktop_type` call. Replacing
// each with its length keeps an approval prompt informative ("64
// characters") without ever showing the content - which is what a reviewer
// of that prompt should be seeing anyway.
//
// The same sanitised form is what reaches `gated()`'s approval payload below,
// for the same reason: an approval row outlives the call.
export function sanitizeArgsForAuthorization(name: string, args: any): any {
  if (name === 'desktop_type' && typeof args?.text === 'string') {
    const { text, ...rest } = args;
    return { ...rest, textLength: text.length };
  }
  if (name === 'desktop_key' && typeof args?.keys === 'string') {
    const { keys, ...rest } = args;
    return { ...rest, keyCount: keys.length };
  }
  if (name === 'desktop_set_value' && typeof args?.value === 'string') {
    const { value, ...rest } = args;
    const requestNonce = args.requestNonce ?? randomUUID();
    return { ...rest, valueLength: value.length, requestNonce };
  }
  return args;
}

function actTarget(args: any): string {
  return args.ref
    ? `ref:${args.ref}`
    : args.x !== undefined
      ? `${args.x},${args.y}`
      : 'focused-element';
}

export async function handleAct(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
  risk: RiskTier,
) {
  const op = ACT_OP[name]!;
  const operation: WorkerOperation = {
    kind: 'desktop.act',
    op,
    ...(args.ref !== undefined ? { ref: String(args.ref) } : {}),
    ...(args.x !== undefined ? { x: Number(args.x) } : {}),
    ...(args.y !== undefined ? { y: Number(args.y) } : {}),
    ...(op === 'type' ? { text: String(args.text ?? '') } : {}),
    ...(op === 'key' ? { keys: String(args.keys ?? '') } : {}),
    ...(args.deltaY !== undefined ? { deltaY: Number(args.deltaY) } : {}),
    policy: policyFor(context),
  };
  // Never the text/keys themselves - only what was targeted and, for
  // `desktop_type`, its length.
  const target = actTarget(args);
  const auditTarget =
    op === 'type' ? `${target} (${String(args.text ?? '').length} chars)` : target;
  const safeArgs = sanitizeArgsForAuthorization(name, args);

  const execute = async () => {
    try {
      const value = await run(context, sessionId, operation);
      // The worker evaluates the gate against the window it observes at the
      // instant it runs, and returns that window identity plus its verdict
      // alongside the action result (see `dispatchDesktopOperation` and
      // `ActResult`) - this is the only source of that data for input actions,
      // since this tool layer has no window identity of its own without an
      // extra describe round trip.
      const window: DesktopWindowIdentity | undefined = value?.window;
      audit(context, sessionId, name, auditTarget, risk, 'SUCCEEDED', {
        window: targetOf(window),
        ...(value?.gateVerdict ? { gateVerdict: value.gateVerdict, gateRule: value.gateRule } : {}),
      });
      return value;
    } catch (error) {
      const err = asToolError(error);
      // A refused action's `details` carries the same window/verdict pair (see
      // the throw in `dispatchDesktopOperation`), so a FAILED row from a
      // gate refusal is distinguishable in the audit trail from one caused by
      // a driver crash, which carries no such details.
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

  // LOW short-circuits inside `gated`, so `desktop_scroll` still costs nothing;
  // everything else reaches an approval unless a permission rule or a one-time
  // grant already covers it.
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
    {},
    execute,
  );
}
