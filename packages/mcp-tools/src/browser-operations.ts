import { MAX_WAIT_FOR_MS } from '../../browser/src/driver.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import { redactText } from '../../security/src/dlp.js';
import { AevraToolError } from './errors.js';

/**
 * Clamps a model-supplied bound. `Number(...)` on junk yields NaN, and NaN
 * propagates through Math.min/Math.max - so an unparseable value has to fall
 * back to the default rather than being "clamped" into NaN.
 */
function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * Rejected rather than clamped. A silently truncated wait reports a timeout the
 * caller never asked for, and the caller cannot tell that from the page simply
 * being slow.
 */
function refuseUnboundedWait(actions: any[]): void {
  for (const action of actions) {
    if (action?.op !== 'wait_for') continue;
    const timeoutMs = Number(action.timeoutMs);
    if (Number.isFinite(timeoutMs) && timeoutMs > MAX_WAIT_FOR_MS) {
      throw new AevraToolError(
        'INVALID_REQUEST',
        `wait_for timeoutMs must not exceed ${MAX_WAIT_FOR_MS}ms`,
      );
    }
  }
}

/**
 * Text the agent is about to send INTO a page, scanned by the same DLP pass
 * that guards a navigation URL.
 *
 * `scanNavigateUrl` exists because an agent that has read a secret can smuggle
 * it out in a URL. Typing that same secret into a textarea on an attacker's
 * page is the identical exfiltration with one fewer step, and the credential
 * guard in the drivers does not cover it - that one refuses typing INTO a
 * password field, which is the opposite direction. `select` carries a value
 * outward as well, so it is scanned too.
 *
 * Refused rather than redacted: a half-redacted string typed into a form is a
 * wrong value silently submitted, which is worse than a refusal. The person
 * at the keyboard can type it themselves.
 */
function refuseSecretOutbound(actions: any[]): void {
  for (const action of actions) {
    const outbound =
      action?.op === 'type' ? action.text : action?.op === 'select' ? action.value : undefined;
    if (typeof outbound !== 'string' || !outbound) continue;
    if (redactText(outbound).redactionCount > 0) {
      throw new AevraToolError(
        'BROWSER_ORIGIN_BLOCKED',
        `Aevra will not type secret-shaped data into a page (${action.op})`,
      );
    }
  }
}

/**
 * Maps a validated tool call onto its worker operation, clamping every bound so
 * a model cannot ask for an unbounded snapshot or log drain.
 */
export function browserOperation(name: string, args: any, tabId?: string): WorkerOperation {
  const tab = tabId === undefined ? {} : { tabId };
  if (name === 'browser_tabs') {
    return {
      kind: 'browser.tabs',
      action: args.action ?? 'list',
      ...(args.url === undefined ? {} : { url: String(args.url) }),
      ...tab,
    };
  }
  if (name === 'browser_navigate') {
    return {
      kind: 'browser.navigate',
      url: String(args.url),
      waitUntil: args.waitUntil === 'idle' ? 'idle' : 'load',
      ...tab,
    };
  }
  if (name === 'browser_snapshot') {
    return {
      kind: 'browser.snapshot',
      mode: args.mode === 'vision' ? 'vision' : 'a11y',
      maxNodes: bounded(args.maxNodes, 400, 1, 2000),
      ...tab,
    };
  }
  if (name === 'browser_read') {
    return {
      kind: 'browser.read',
      format: args.format === 'html' ? 'html' : 'text',
      ...(args.ref === undefined ? {} : { ref: String(args.ref) }),
      ...(args.selector === undefined ? {} : { selector: String(args.selector) }),
      ...tab,
    };
  }
  if (name === 'browser_logs') {
    return {
      kind: 'browser.logs',
      logKind: args.kind === 'network' ? 'network' : 'console',
      limit: bounded(args.limit, 50, 1, 500),
      ...(args.since === undefined ? {} : { since: String(args.since) }),
      ...tab,
    };
  }
  const actions = Array.isArray(args.actions) ? args.actions : [];
  if (!actions.length) {
    throw new AevraToolError('INVALID_REQUEST', 'browser_act_many requires at least one action');
  }
  refuseUnboundedWait(actions);
  refuseSecretOutbound(actions);
  return {
    kind: 'browser.act',
    actions,
    stopOnError: args.stopOnError !== false,
    ...tab,
  };
}
