import type {
  DesktopPolicy,
  DesktopTargetIdentity,
  DesktopWindowIdentity,
} from '../../protocol/src/desktop.js';

export type GateDirection = 'capture' | 'input' | 'background';

export interface GateVerdict {
  allowed: boolean;
  reason: string;
  attribution: 'attributed' | 'unattributable';
}

/**
 * The final path segment of an executable path, independent of the host OS's
 * own separator convention - this must parse a Windows-style path even when
 * running on a non-Windows test host, so it splits on both `\` and `/`
 * itself rather than delegating to `node:path`. Trailing separators are
 * stripped first: `C:\App\cmd.exe\` must still resolve to `cmd.exe`, not to
 * an empty final segment that would silently drop out of matching.
 */
export function basename(executablePath: string): string {
  const trimmed = executablePath.replace(/[\\/]+$/, '');
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] ?? '';
}

/**
 * The identity fields that are actually present and non-empty, lower-cased.
 * A field absent, or reduced to '' after basename-stripping, is not
 * "present" - it must never be treated as matching or failing to match.
 */
function presentFields(identity: DesktopWindowIdentity): string[] {
  const fields: string[] = [];
  if (identity.processName) {
    fields.push(identity.processName.toLowerCase());
  }
  if (identity.executablePath) {
    const base = basename(identity.executablePath).toLowerCase();
    if (base !== '') {
      fields.push(base);
    }
  }
  return fields;
}

/**
 * A window is attributable only when the OS gave us something USABLE to
 * judge - the same standard `matches()` applies via `presentFields()`, not
 * an independent truthiness check. The two used to disagree in exactly the
 * cases `presentFields()` exists to filter out: an executablePath of only
 * separators (`\\`, `/`, `\\\\`) is a truthy string but strips to an empty
 * basename, and an empty-string `processName` is truthy but useless. Both
 * used to count as "attributed" while `matches()` correctly saw no usable
 * field, so an identity like that fell through denylist's `!listed`
 * default-allow as though it had been checked, when nothing had actually
 * been matched against the policy at all. Deriving attribution from
 * `presentFields()` makes the two questions - "is this attributed" and
 * "does this match the policy" - agree by construction.
 *
 * The cases that suppress attribution entirely - the Windows UAC secure
 * desktop, macOS secure input mode, Wayland - are exactly the sensitive
 * ones, so "unknown" must never widen what is permitted.
 */
function attributed(identity: DesktopWindowIdentity): boolean {
  return presentFields(identity).length > 0;
}

/**
 * Whether this identity is on the policy's list, direction-aware:
 *
 * - denylist: matches if ANY present field matches an entry. More matches
 *   means less access, so OR is the safe direction - a window is denylisted
 *   the moment either its process name or its executable path is listed.
 * - allowlist: matches only if EVERY present field matches the SAME entry.
 *   OR would be unsafe here: an identity could report a clean processName
 *   alongside a spoofed executablePath (or vice versa) and gain entry on
 *   one field alone. Requiring all present fields to agree closes that.
 *
 * Both directions fail closed: an identity with no present fields (which
 * cannot reach here as 'attributed' - see `attributed` above, but guarded
 * regardless) never matches, so it is never granted by an allowlist.
 */
function matches(identity: DesktopWindowIdentity, policy: DesktopPolicy): boolean {
  const fields = presentFields(identity);
  if (fields.length === 0) {
    return false;
  }
  const applications = policy.applications.map((entry) => entry.toLowerCase());
  const fieldMatches = fields.map((field) => applications.includes(field));
  return policy.mode === 'denylist' ? fieldMatches.some(Boolean) : fieldMatches.every(Boolean);
}

/**
 * Case-insensitive EXACT match against `policy.deniedTitlePatterns` (the
 * whole title, not a substring). This exists ONLY as a defense-in-depth
 * mitigation for Aevra's own admin UI: at window granularity that UI's
 * identity IS its browser's process, so no process-based denylist can
 * single it out without denylisting the whole browser - which is exactly
 * what a desktop agent most needs to drive.
 *
 * Exact match, not substring: the admin UI's title is exactly "Aevra"
 * (apps/web-react/index.html), and a substring rule would also refuse input
 * to any window whose title merely CONTAINS that word - an editor with this
 * repo open, a browser tab on Aevra's GitHub page, a file manager in an
 * "aevra" directory. That blocked legitimate work with no security benefit
 * (none of those windows ARE the admin UI) and trained people to turn the
 * mitigation off. Exact match keeps the one case it can actually help with
 * without the collateral refusals.
 *
 * A window title is NOT a trustworthy identity signal: any page can set
 * `document.title` to anything, including a string chosen specifically to
 * either dodge or forge a match here. Callers must treat a hit as one more
 * speed bump alongside approvals and the admin UI's own auth boundary, never
 * as proof - and this function is wired so it can only ever take access
 * away (see its one call site below), never grant it.
 *
 * LIMITATION THAT NO PATTERN CAN CLOSE: an OS window title reflects only the
 * ACTIVE tab. If the admin UI is sitting in a BACKGROUND tab of a browser
 * whose focused tab shows something benign, this check sees only the benign
 * title, finds no match, and permits input - and a single Ctrl+Tab from
 * there reaches the admin UI with nothing here having changed. This is not a
 * gap in the pattern list; it is the mechanism itself being blind to
 * anything that is not the frontmost tab. That is the honest reason this
 * check is defense in depth only, never protection - it is written here so
 * nobody mistakes exact matching (or any other pattern refinement) for a fix
 * to that blind spot.
 */
function titleDenied(identity: DesktopWindowIdentity, policy: DesktopPolicy): boolean {
  return isProtectedDesktopTitle(identity, policy);
}

export function evaluateWindowGate(
  identity: DesktopWindowIdentity,
  policy: DesktopPolicy,
  direction: GateDirection,
): GateVerdict {
  const attribution = attributed(identity) ? 'attributed' : 'unattributable';

  // Reading is recoverable and reviewable; acting is neither. The two
  // directions are priced differently on purpose.
  if (direction === 'capture') {
    return { allowed: true, reason: 'capture is permitted regardless of attribution', attribution };
  }

  if (attribution === 'unattributable') {
    if (direction === 'background') {
      return {
        allowed: false,
        reason: 'window identity is unavailable for background target',
        attribution,
      };
    }
    return policy.unattributedInput === 'allow'
      ? { allowed: true, reason: 'unattributedInput is set to allow', attribution }
      : { allowed: false, reason: 'window identity is unavailable', attribution };
  }

  const listed = matches(identity, policy);
  const baseAllowed = policy.mode === 'allowlist' ? listed : !listed;
  // Title matching only ever takes access away, never grants it - see
  // `titleDenied` above for why a title can never be trusted to prove safety.
  if (baseAllowed && titleDenied(identity, policy)) {
    return {
      allowed: false,
      reason:
        'refused by deniedTitlePatterns (defense in depth only - window titles are attacker-influenceable)',
      attribution,
    };
  }
  return {
    allowed: baseAllowed,
    reason: baseAllowed ? `permitted by ${policy.mode}` : `refused by ${policy.mode}`,
    attribution,
  };
}

/** Canonical comparison for executable paths returned by Windows and stored by Core. */
export function canonicalExecutablePath(value: string): string {
  let normalized = value.trim().replaceAll('/', '\\');
  if (/^\\\\\?\\UNC\\/i.test(normalized)) {
    normalized = `\\\\${normalized.slice(8)}`;
  } else if (/^\\\\\?\\/i.test(normalized)) {
    normalized = normalized.slice(4);
  }
  return normalized.replace(/\\+$/, '').toLowerCase();
}

function isSharedWebViewRuntime(identity: DesktopWindowIdentity): boolean {
  return [
    identity.processName,
    identity.executablePath ? basename(identity.executablePath) : undefined,
  ].some((field) => field?.toLowerCase() === 'msedgewebview2.exe');
}

export function isProtectedDesktopTitle(
  identity: DesktopWindowIdentity,
  policy: DesktopPolicy,
): boolean {
  const title = identity.title?.toLowerCase();
  return Boolean(
    title && policy.deniedTitlePatterns?.some((pattern) => title === pattern.toLowerCase()),
  );
}

function hasExactGrant(
  path: string | undefined,
  policy: DesktopPolicy,
  sessionId?: string,
): boolean {
  if (!path) return false;
  const identity = canonicalExecutablePath(path);
  if (!identity) return false;
  return Boolean(
    policy.appGrants?.some((grant) => {
      if (grant.sessionId !== undefined && grant.sessionId !== sessionId) return false;
      return canonicalExecutablePath(grant.executablePath) === identity;
    }),
  );
}

/**
 * Evaluates direct app rules and exact-path grants. A WebView2 target may
 * inherit an allowlist grant only from a helper-verified native host identity.
 * Legacy basename rules continue to apply to ordinary apps and to an
 * explicitly configured broad WebView2 rule.
 */
export function evaluateDesktopTargetGate(
  identity: DesktopTargetIdentity,
  policy: DesktopPolicy,
  direction: GateDirection,
  sessionId?: string,
): GateVerdict {
  const target = identity.window;
  const targetVerdict = evaluateWindowGate(target, policy, direction);
  if (direction === 'capture') return targetVerdict;
  if (policy.mode === 'denylist') {
    if (!targetVerdict.allowed) return targetVerdict;
    if (isSharedWebViewRuntime(target) && identity.hostApplication) {
      const host = identity.hostApplication;
      const hostVerdict = evaluateWindowGate(
        {
          windowId: host.instance.windowId,
          processName: basename(host.executablePath),
          executablePath: host.executablePath,
          ...(target.title ? { title: target.title } : {}),
        },
        policy,
        direction,
      );
      if (!hostVerdict.allowed) {
        return {
          ...hostVerdict,
          reason: `refused by denylist (verified host ${basename(host.executablePath)})`,
        };
      }
    }
    return targetVerdict;
  }
  if (!targetVerdict.allowed) {
    if (isProtectedDesktopTitle(target, policy)) return targetVerdict;

    if (isSharedWebViewRuntime(target)) {
      const host = identity.hostApplication;
      if (!host) {
        return {
          ...targetVerdict,
          reason: 'WebView2 host could not be verified; no host grant applies',
        };
      }
      if (hasExactGrant(host.executablePath, policy, sessionId)) {
        return {
          allowed: true,
          reason: 'permitted by exact-path grant for verified host application',
          attribution: targetVerdict.attribution,
        };
      }
      return {
        ...targetVerdict,
        reason: 'refused by allowlist (verified host has no exact-path grant)',
      };
    }

    if (hasExactGrant(target.executablePath, policy, sessionId)) {
      return {
        allowed: true,
        reason: 'permitted by exact-path application grant',
        attribution: targetVerdict.attribution,
      };
    }
  }
  return targetVerdict;
}
