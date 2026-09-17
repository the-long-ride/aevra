import type { DesktopPolicy } from '../../../../packages/protocol/src/desktop.js';
import { isValidDesktopPolicy } from '../../../../packages/mcp-tools/src/desktop-support.js';
import { defaultDesktopPolicy } from '../../../../packages/security/src/desktop-policy-defaults.js';

const SETTINGS_KEY = 'desktop.policy';

interface SettingsLike {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}

/**
 * Which application list a requested update should start from.
 *
 * `applications` means the OPPOSITE thing in each mode, so carrying it across
 * a mode change silently inverts the operator's intent: the shipped denylist
 * of terminals, password managers and the UAC consent dialog would become the
 * single set of apps the agent is allowed to drive, and every ordinary app
 * would stop working - the exact reverse of what clicking "only these apps"
 * asks for. A mode change therefore starts from that mode's own safe
 * baseline: empty for an allowlist, which fails closed until the operator
 * picks apps, and the built-in sensitive-app list for a denylist. A caller
 * that genuinely wants a list carried over can still pass one explicitly in
 * the same request.
 */
function applicationsFor(next: Partial<DesktopPolicy>, current: DesktopPolicy): string[] {
  if (next.applications !== undefined) return next.applications;
  if (next.mode === undefined || next.mode === current.mode) return current.applications;
  return next.mode === 'allowlist' ? [] : defaultDesktopPolicy().applications;
}

/**
 * Trims blanks and collapses case-insensitive duplicates, keeping the first
 * spelling seen. The window gate and `desktop_apps` both match lowercased, so
 * `1Password.exe` and `1password.exe` are one rule to them; storing both
 * would show the same app twice in the picker and report it twice to the
 * model while changing nothing about what is actually permitted.
 */
function normalizeApplications(entries: string[]): string[] {
  if (!Array.isArray(entries)) return entries;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    // Anything that is not a string passes through untouched so the
    // fail-closed `isValidDesktopPolicy` check below still rejects it,
    // rather than being silently sanitized away into a valid-looking policy.
    if (typeof entry !== 'string') {
      result.push(entry);
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    result.push(trimmed);
  }
  return result;
}

/**
 * Operator-editable desktop control policy: which apps `desktop.control` may
 * act on, and whether the model is told their full executable paths.
 * Mirrors `BrowserOriginPolicyService`'s settings-backed read/update shape;
 * simpler because desktop policy has no live config (ports, origins) to
 * merge in on every snapshot. Reuses `isValidDesktopPolicy`, the same
 * fail-closed validator `policyFor()` in mcp-tools already applies when
 * reading this same settings key, so the two can never disagree about what
 * counts as a valid stored policy.
 */
export class DesktopPolicyService {
  constructor(private readonly settings: SettingsLike) {}

  snapshot(): DesktopPolicy {
    const stored = this.settings.get<unknown>(SETTINGS_KEY, defaultDesktopPolicy());
    return isValidDesktopPolicy(stored) ? stored : defaultDesktopPolicy();
  }

  update(next: Partial<DesktopPolicy>): DesktopPolicy {
    const current = this.snapshot();
    const merged: DesktopPolicy = {
      ...current,
      ...(next.mode === undefined ? {} : { mode: next.mode }),
      applications: normalizeApplications(applicationsFor(next, current)),
      ...(next.exposeExecutablePaths === undefined
        ? {}
        : { exposeExecutablePaths: next.exposeExecutablePaths }),
      ...(next.unattributedInput === undefined
        ? {}
        : { unattributedInput: next.unattributedInput }),
      ...(next.deniedTitlePatterns === undefined
        ? {}
        : { deniedTitlePatterns: next.deniedTitlePatterns }),
    };
    if (!isValidDesktopPolicy(merged)) {
      throw Object.assign(new Error('Invalid desktop policy'), {
        code: 'DESKTOP_POLICY_INVALID',
        status: 400,
      });
    }
    this.settings.set(SETTINGS_KEY, merged);
    return merged;
  }
}
