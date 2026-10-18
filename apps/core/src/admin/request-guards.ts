import type { IncomingMessage } from 'node:http';

const HOST_PATTERN = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i;
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];
const WILDCARD_BINDS = new Set(['', '0.0.0.0', '::', '[::]']);

/** Reads one cookie; a value that is not valid percent-encoding is treated as absent. */
export function cookie(req: IncomingMessage, name: string) {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join('='));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isLoopback(address: string | undefined) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function hostnameOf(value: string | undefined) {
  if (!value) return undefined;
  const match = HOST_PATTERN.exec(value.trim());
  return match?.[1]?.toLowerCase();
}

function originHostname(origin: string) {
  try {
    const { hostname } = new URL(origin);
    return hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Host allow-list for the Admin listener. Loopback names, the listener's own bind and
 * advertised names, and the hosts of configured trusted origins are accepted; anything
 * else (a DNS-rebinding name, for instance) is refused before any route runs.
 */
export function adminHostAllowed(
  hostHeader: string | undefined,
  bindHost: string,
  advertisedHost: string | undefined,
  trustedOrigins: string[],
) {
  const hostname = hostnameOf(hostHeader);
  if (!hostname) return false;
  const allowed = new Set(LOOPBACK_HOSTNAMES);
  for (const name of [bindHost, advertisedHost]) {
    const normalized = hostnameOf(
      name?.includes(':') && !name.startsWith('[') ? `[${name}]` : name,
    );
    if (normalized && !WILDCARD_BINDS.has(normalized)) allowed.add(normalized);
  }
  for (const origin of trustedOrigins) {
    const name = originHostname(origin);
    if (name) allowed.add(name);
  }
  return allowed.has(hostname);
}
