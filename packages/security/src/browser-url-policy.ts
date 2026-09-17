import { redactText } from './dlp.js';

export interface NavigateUrlScan {
  blocked: boolean;
  reason?: string;
  parameter?: string;
}

/**
 * Path segments are scanned one at a time rather than as a whole path. The DLP
 * pass deliberately grants slash-bearing runs some immunity so real filesystem
 * paths survive tool output, and a URL path is exactly such a run - so scanning
 * `/exfil/<secret>` whole lets the payload through. Split first, judge each
 * segment on its own, and the immunity no longer applies.
 */
function scanPath(pathname: string): NavigateUrlScan | null {
  for (const raw of pathname.split('/')) {
    if (!raw) continue;
    let segment = raw;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      // A malformed escape is judged as written rather than skipped.
    }
    if (redactText(segment).redactionCount > 0) {
      return { blocked: true, reason: 'URL path carries secret-shaped data' };
    }
  }
  return null;
}

/**
 * `browser_navigate` is the sharpest exfiltration edge in browser control: an
 * agent that has read a secret can smuggle it out in a URL, and no approval on
 * the *click* would ever see it. Every carried value - query, fragment, and
 * path - goes through the same DLP pass that redacts tool output; one hit
 * blocks the navigation.
 */
export function scanNavigateUrl(url: string): NavigateUrlScan {
  let parsed: URL;
  try {
    parsed = new URL(String(url));
  } catch {
    return { blocked: true, reason: 'Navigation URL could not be parsed' };
  }

  for (const [name, value] of parsed.searchParams) {
    if (redactText(value).redactionCount > 0) {
      return {
        blocked: true,
        parameter: name,
        reason: `Query parameter "${name}" carries secret-shaped data`,
      };
    }
  }
  const fragment = parsed.hash.replace(/^#/, '');
  if (fragment && redactText(fragment).redactionCount > 0) {
    return { blocked: true, reason: 'URL fragment carries secret-shaped data' };
  }
  return scanPath(parsed.pathname) ?? { blocked: false };
}
