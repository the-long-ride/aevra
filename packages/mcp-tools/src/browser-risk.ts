import type { BrowserOriginClass } from '../../protocol/src/browser.js';
import type { RiskTier } from '../../protocol/src/index.js';
import { classifyOrigin, registrableDomain } from '../../browser/src/origin-policy.js';
import type { OriginPolicyConfig } from '../../browser/src/origin-policy.js';
import { AevraToolError } from './errors.js';

const READ_ONLY = new Set([
  'browser_status',
  'browser_tabs',
  'browser_read',
  'browser_logs',
  'browser_snapshot',
]);

// Per MCP session, the registrable domains already reached this session. A first
// navigation to a new domain is MEDIUM; returning to one already visited is not.
const visited = new Map<string, Set<string>>();

/**
 * Ledger cap. This is first-visit state, not an audit record: losing the least
 * recently used entry costs one extra MEDIUM tier on a re-navigation, which is
 * the safe direction to fail. A cap bounds the map without depending on a
 * teardown call site this codebase does not settle in one place.
 */
const MAX_TRACKED_SESSIONS = 256;

// Per-session domain cap, for the same reason as the session cap above: this
// is first-visit state, not an audit record, and a long-lived session that
// crawls many domains should not grow this set without bound. Dropping the
// oldest domain costs one extra MEDIUM tier on a re-navigation.
const MAX_TRACKED_DOMAINS_PER_SESSION = 512;

export function noteVisited(sessionId: string, url: string): void {
  const domain = registrableDomain(url);
  if (!domain) return;
  const seen = visited.get(sessionId) ?? new Set<string>();
  // Re-insert so the domain becomes the most recently used entry too.
  seen.delete(domain);
  seen.add(domain);
  while (seen.size > MAX_TRACKED_DOMAINS_PER_SESSION) {
    const oldest = seen.values().next();
    if (oldest.done) break;
    seen.delete(oldest.value);
  }
  // Re-insert so this session becomes the most recently used key.
  visited.delete(sessionId);
  visited.set(sessionId, seen);
  while (visited.size > MAX_TRACKED_SESSIONS) {
    const oldest = visited.keys().next();
    if (oldest.done) break;
    visited.delete(oldest.value);
  }
}

export function isFirstVisit(sessionId: string, url: string): boolean {
  const domain = registrableDomain(url);
  return domain ? !(visited.get(sessionId)?.has(domain) ?? false) : true;
}

export function resetVisited(sessionId: string): void {
  visited.delete(sessionId);
}

export function trackedSessionCount(): number {
  return visited.size;
}

export function refuseBlockedOrigin(url: string, policy?: Partial<OriginPolicyConfig>): void {
  if (classifyOrigin(url, policy) === 'BLOCKED') {
    throw new AevraToolError(
      'BROWSER_ORIGIN_BLOCKED',
      `Aevra will not drive a browser on a privileged surface: ${url}`,
    );
  }
}

/**
 * Pixels cannot be DLP-redacted, so a screenshot of a sensitive origin is
 * refused outright rather than ticketed - there is nothing an approval could
 * make safe. The user takes that screenshot themselves.
 */
export function refuseSensitiveScreenshot(originClass: BrowserOriginClass, mode: string): void {
  if (mode === 'vision' && originClass === 'SENSITIVE') {
    throw new AevraToolError(
      'BROWSER_ORIGIN_BLOCKED',
      'A screenshot of a sensitive origin cannot be redacted, so it is refused',
    );
  }
}

export function browserOperationRisk(input: {
  tool: string;
  originClass: BrowserOriginClass;
  currentOriginClass?: BrowserOriginClass;
  crossOrigin?: boolean;
  firstVisit?: boolean;
  /**
   * True for any operation that sends the browser to a URL. Keyed on behaviour
   * rather than tool name because `browser_tabs {action:'open'}` navigates just
   * as `browser_navigate` does, and must be tiered the same way.
   */
  navigates?: boolean;
}): RiskTier {
  if (input.originClass === 'SENSITIVE') return 'HIGH';
  // Leaving a sensitive page for another origin is the exfiltration shape no
  // approval on the click would have caught, so it is HIGH even when the
  // destination itself is ordinary.
  if (input.currentOriginClass === 'SENSITIVE' && input.crossOrigin) return 'HIGH';
  if (input.navigates) return input.firstVisit ? 'MEDIUM' : 'LOW';
  return READ_ONLY.has(input.tool) ? 'LOW' : 'MEDIUM';
}
