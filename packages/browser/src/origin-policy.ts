import type { BrowserOriginClass, BrowserOperationKind } from '../../protocol/src/browser.js';
import type { RiskTier } from '../../protocol/src/index.js';

const BLOCKED_SCHEMES = new Set([
  'chrome:',
  'chrome-extension:',
  'chrome-search:',
  'chrome-untrusted:',
  'devtools:',
  'edge:',
  'brave:',
  'opera:',
  'about:',
  'file:',
  'view-source:',
  'data:',
  'blob:',
  'javascript:',
]);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Ports Aevra listens on by default, used only when no config is supplied. */
const DEFAULT_AEVRA_PORTS = [47830, 47831, 47832, 47833];

/** Matched against the hostname alone. */
const SENSITIVE_HOST_PATTERNS = [
  /(^|\.)paypal\./i,
  /(^|\.)stripe\.com$/i,
  /(^|\.)coinbase\./i,
  /(^|\.)binance\./i,
  // Deliberately host-only: matched against a path as well, this caught
  // `example.com/bankruptcy-guide` and tiered an ordinary page HIGH.
  /(^|\.)[a-z0-9-]*bank[a-z0-9-]*(\.|$)/i,
  /(^|\.)chase\.com$/i,
  /(^|\.)wellsfargo\.com$/i,
  /(^|\.)mail\.google\.com$/i,
  /(^|\.)outlook\.(com|office\.com|live\.com)$/i,
  /(^|\.)mail\.yahoo\.com$/i,
  /(^|\.)proton\.me$/i,
  /(^|\.)console\.aws\.amazon\.com$/i,
  /(^|\.)portal\.azure\.com$/i,
  /(^|\.)console\.cloud\.google\.com$/i,
  /(^|\.)login\.microsoftonline\.com$/i,
  /(^|\.)accounts\.google\.com$/i,
  /(^|\.)okta\.com$/i,
  /(^|\.)auth0\.com$/i,
  /(^|\.)id\.atlassian\.com$/i,
];

/** Matched against `host + pathname`, for surfaces identified by their route. */
const SENSITIVE_PATH_PATTERNS = [/(^|\.)github\.com\/settings/i];

const MULTI_PART_TLDS = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'co.jp',
  'com.au',
  'com.br',
  'com.vn',
  'co.nz',
  'com.sg',
]);

export interface OriginPolicyConfig {
  blockedHosts: string[];
  sensitiveHosts: string[];
  hasPasswordField: boolean;
  /**
   * Live Aevra listener ports. Always BLOCKED and never operator-editable:
   * this is the rule that stops the agent reaching the surface that grants
   * its own capabilities.
   */
  aevraPorts: number[];
  /**
   * Live NON-loopback origins that serve the same surface - the public
   * gateway's advertised URL, a managed Cloudflare hostname, every trusted
   * admin origin. Also never operator-editable, for the same reason.
   *
   * The port rule alone did not cover these. Aevra is reachable off-loopback
   * by design, and `https://<tunnel-host>/` is the admin UI on port 443 under
   * a hostname no port list can name - it classified NORMAL and was drivable.
   * Matched by HOSTNAME, not by full origin: a host that serves Aevra's own
   * control plane on one port is not somewhere the agent should be browsing
   * on another.
   */
  aevraOrigins: string[];
  /** Every other loopback origin. The operator's call. */
  loopbackClass: BrowserOriginClass;
}

export const DEFAULT_ORIGIN_POLICY: OriginPolicyConfig = {
  blockedHosts: [],
  sensitiveHosts: [],
  hasPasswordField: false,
  aevraPorts: DEFAULT_AEVRA_PORTS,
  aevraOrigins: [],
  loopbackClass: 'SENSITIVE',
};

const SEVERITY: Record<BrowserOriginClass, number> = { NORMAL: 0, SENSITIVE: 1, BLOCKED: 2 };

function strictest(left: BrowserOriginClass, right: BrowserOriginClass): BrowserOriginClass {
  return SEVERITY[left] >= SEVERITY[right] ? left : right;
}

/**
 * True for every spelling a browser will actually route to this machine.
 *
 * The WHATWG URL parser normalises `127.1`, `0x7f.0.0.1`, `2130706433` and a
 * trailing dot down to `127.0.0.1` before we see them, so those need no rule
 * here. These do, and each of them reaches an Aevra listener:
 * the rest of `127.0.0.0/8`, the unspecified addresses, an IPv4-mapped IPv6
 * literal on a dual-stack socket, and any `*.localhost` name, which Chrome
 * resolves to loopback under RFC 6761 without ever consulting DNS.
 */
function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host === '0.0.0.0' || host.endsWith('.localhost')) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host.startsWith('[') && host.endsWith(']')) return isLoopbackIpv6(host.slice(1, -1));
  return false;
}

function isLoopbackIpv6(address: string): boolean {
  if (address === '::' || address === '::1') return true;
  if (/^::ffff:127\./i.test(address)) return true;
  // Compressed form: `[::ffff:7f00:1]` is how Node serialises ::ffff:127.0.0.1.
  const mapped = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/i.exec(address);
  return mapped ? Number.parseInt(mapped[1]!, 16) >>> 8 === 127 : false;
}

/** Exact hostname or any subdomain of it, so one entry covers a whole site. */
function matchesHost(list: string[] | undefined, host: string): boolean {
  return (list ?? []).some((entry) => {
    const target = entry.trim().toLowerCase().replace(/^\./, '');
    return target !== '' && (host === target || host.endsWith(`.${target}`));
  });
}

function parse(url: string): URL | null {
  try {
    return new URL(String(url ?? ''));
  } catch {
    return null;
  }
}

/**
 * The hostname of an Aevra origin entry. Entries arrive as whole URLs from
 * exposure config (`https://aevra.example.com`), so they are parsed; a bare
 * hostname someone wrote by hand is accepted as-is rather than dropped.
 */
function aevraHost(entry: string): string {
  const trimmed = String(entry ?? '')
    .trim()
    .toLowerCase();
  if (!trimmed) return '';
  return parse(trimmed)?.hostname ?? trimmed.replace(/^\/+/, '').split('/')[0] ?? '';
}

function isAevraOrigin(list: string[] | undefined, host: string): boolean {
  return (list ?? []).some((entry) => {
    const target = aevraHost(entry);
    return target !== '' && host === target;
  });
}

export function registrableDomain(url: string): string {
  const parsed = parse(url);
  if (!parsed) return '';
  const parts = parsed.hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return parsed.hostname;
  const lastTwo = parts.slice(-2).join('.');
  return MULTI_PART_TLDS.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

export function classifyOrigin(
  url: string,
  config: Partial<OriginPolicyConfig> = {},
): BrowserOriginClass {
  const parsed = parse(url);
  if (!parsed) return 'BLOCKED';
  if (BLOCKED_SCHEMES.has(parsed.protocol)) return 'BLOCKED';
  const host = parsed.hostname.toLowerCase();
  const loopback = isLoopbackHost(host);

  // Unconditional, and deliberately NOT inside the loopback branch it used to
  // live in. Aevra is reachable off-loopback - a LAN address, the public
  // gateway, a managed tunnel - and every one of those serves the surface that
  // grants the agent its own capabilities. An operator who sets loopbackClass
  // to NORMAL still cannot hand the agent Aevra's admin UI, by any route.
  //
  // An empty array is not a configured answer, it is a missing one - `??`
  // alone would let it silently disable the port rule.
  const ports = config.aevraPorts?.length ? config.aevraPorts : DEFAULT_AEVRA_PORTS;
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  if (ports.includes(port)) return 'BLOCKED';
  if (isAevraOrigin(config.aevraOrigins, host)) return 'BLOCKED';

  // The loopback class is a floor, not a final answer. Taking it last let a
  // password field downgrade an operator's BLOCKED to SENSITIVE; every rule
  // below can only tighten it.
  let verdict: BrowserOriginClass = loopback
    ? (config.loopbackClass ?? DEFAULT_ORIGIN_POLICY.loopbackClass)
    : 'NORMAL';
  if (verdict === 'BLOCKED') return 'BLOCKED';
  if (matchesHost(config.blockedHosts, host)) return 'BLOCKED';
  if (config.hasPasswordField) verdict = strictest(verdict, 'SENSITIVE');
  if (matchesHost(config.sensitiveHosts, host)) verdict = strictest(verdict, 'SENSITIVE');
  if (SENSITIVE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    verdict = strictest(verdict, 'SENSITIVE');
  }
  const target = `${host}${parsed.pathname}`;
  if (SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(target))) {
    verdict = strictest(verdict, 'SENSITIVE');
  }
  return verdict;
}

export interface BrowserRiskDecision {
  decision: 'allow' | 'deny';
  risk: RiskTier;
}

const READ_KINDS = new Set<BrowserOperationKind>([
  'browser.snapshot',
  'browser.read',
  'browser.logs',
  'browser.tabs',
]);

export function riskForOperation(input: {
  kind: BrowserOperationKind;
  originClass: BrowserOriginClass;
  firstVisitToDomain: boolean;
}): BrowserRiskDecision {
  if (input.originClass === 'BLOCKED') return { decision: 'deny', risk: 'CRITICAL' };
  if (input.originClass === 'SENSITIVE') return { decision: 'allow', risk: 'HIGH' };
  if (input.kind === 'browser.navigate') {
    return { decision: 'allow', risk: input.firstVisitToDomain ? 'MEDIUM' : 'LOW' };
  }
  if (READ_KINDS.has(input.kind)) return { decision: 'allow', risk: 'LOW' };
  return { decision: 'allow', risk: 'MEDIUM' };
}
