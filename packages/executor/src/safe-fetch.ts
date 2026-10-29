import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { LookupFunction } from 'node:net';

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type SafeFetchLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  maxBytes: number;
  maxRedirects: number;
  timeoutMs: number;
  /** Resolver; injected by tests so no real DNS is used. */
  lookup?: SafeFetchLookup;
  /**
   * Test seam only: maps the vetted public address to the address actually
   * dialled (a local server). Production callers never pass it.
   */
  dialOverride?: (vettedAddress: string, family: number) => string;
}

export interface SafeFetchResult {
  status: number;
  body: AsyncIterable<Uint8Array>;
  contentType?: string;
  /** Releases the connection when the body will not be read. */
  close(): void;
}

function coded(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function ipv4Public(a: number, b: number) {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

function parseV6(ip: string): number[] | null {
  let text = ip.split('%')[0]!;
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const o = tail[1]!.split('.').map(Number);
    text = text.slice(0, -tail[1]!.length) + (o[0]! * 256 + o[1]!).toString(16);
    text += ':' + (o[2]! * 256 + o[3]!).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

/** True only for globally routable unicast addresses; unparseable input is not public. */
export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip.split('%')[0] ?? '');
  if (family === 4) {
    const o = ip.split('.').map(Number);
    return ipv4Public(o[0]!, o[1]!);
  }
  if (family !== 6) return false;
  const g = parseV6(ip);
  if (!g) return false;
  const v4 = (hi: number, lo: number) => ipv4Public(hi >> 8, hi & 255) && !(hi === 0 && lo === 0);
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96) carry an embedded IPv4 address.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4(g[6]!, g[7]!);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return v4(g[6]!, g[7]!);
  }
  // 6to4 (2002::/16) embeds the IPv4 address in the next 32 bits.
  if (g[0] === 0x2002) return v4(g[1]!, g[2]!);
  // Only global unicast 2000::/3 is public; this excludes ::, ::1, fc00::/7, fe80::/10, ff00::/8.
  if ((g[0]! & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false;
  return true;
}

const defaultLookup: SafeFetchLookup = async (hostname) =>
  (await dns.lookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({
    address,
    family,
  }));

function parseTarget(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw coded('URL_SCHEME', 'Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw coded('URL_SCHEME', 'Only http and https URLs are allowed');
  }
  if (url.username || url.password) throw coded('URL_SCHEME', 'URLs with credentials are refused');
  return url;
}

async function vet(url: URL, lookup: SafeFetchLookup): Promise<ResolvedAddress> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const literal = net.isIP(host);
  const answers = literal ? [{ address: host, family: literal }] : await lookup(host);
  if (!answers.length || !answers.every((a) => isPublicAddress(a.address))) {
    throw coded('URL_NOT_PUBLIC', `Refusing to fetch ${host}: not a public address`);
  }
  return answers[0]!;
}

function pinnedLookup(address: string, family: number): LookupFunction {
  return ((_host: string, options: { all?: boolean }, cb: (...args: any[]) => void) => {
    if (options?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  }) as LookupFunction;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * GET with an SSRF guard: every hop resolves the name itself, refuses any
 * non-public answer, then connects to the very address it vetted (a pinned
 * lookup), so a second DNS answer cannot redirect the connection.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const lookup = options.lookup ?? defaultLookup;
  let current = parseTarget(rawUrl);
  let headers: Record<string, string> = { ...options.headers };
  let active: http.ClientRequest | undefined;
  let timedOut = false;
  // Name resolution is not a socket, so destroying the request cannot stop it.
  // The timer rejects this promise instead, and every vet() races against it.
  let expire!: (error: Error) => void;
  const deadline = new Promise<never>((_, reject) => {
    expire = reject;
  });
  deadline.catch(() => {});
  const timer = setTimeout(() => {
    timedOut = true;
    active?.destroy();
    expire(coded('URL_TIMEOUT', 'Fetch timed out'));
  }, options.timeoutMs);
  timer.unref();
  try {
    for (let hop = 0; ; hop++) {
      const vetting = vet(current, lookup);
      vetting.catch(() => {});
      const vetted = await Promise.race([vetting, deadline]);
      if (timedOut) throw coded('URL_TIMEOUT', 'Fetch timed out');
      const dial = options.dialOverride?.(vetted.address, vetted.family) ?? vetted.address;
      const dialFamily = net.isIP(dial) || vetted.family;
      const lib = current.protocol === 'https:' ? https : http;
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = lib.request(
          {
            protocol: current.protocol,
            hostname: current.hostname.replace(/^\[|\]$/g, ''),
            port: current.port || undefined,
            path: `${current.pathname}${current.search}`,
            method: 'GET',
            headers: { ...headers, 'accept-encoding': 'identity' },
            lookup: pinnedLookup(dial, dialFamily),
            agent: false,
          },
          resolve,
        );
        active = req;
        req.once('error', reject);
        req.end();
      });
      const location = response.headers.location;
      if (REDIRECTS.has(response.statusCode ?? 0) && location) {
        // A redirect body is never read; destroying it stops an endless one.
        response.destroy();
        if (hop >= options.maxRedirects) {
          throw coded('TOO_MANY_REDIRECTS', 'Too many redirects');
        }
        const next = parseTarget(new URL(location, current).toString());
        if (next.origin !== current.origin) headers = {};
        current = next;
        continue;
      }
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > options.maxBytes) {
        response.destroy();
        throw coded('SIZE_LIMIT', `Response exceeds ${options.maxBytes} bytes`);
      }
      const type = response.headers['content-type'];
      return {
        status: response.statusCode ?? 0,
        ...(type ? { contentType: type } : {}),
        body: limited(response, options.maxBytes, timer, () => timedOut),
        close() {
          clearTimeout(timer);
          response.destroy();
        },
      };
    }
  } catch (error) {
    clearTimeout(timer);
    if (timedOut) throw coded('URL_TIMEOUT', 'Fetch timed out');
    throw error;
  }
}

async function* limited(
  response: http.IncomingMessage,
  maxBytes: number,
  timer: NodeJS.Timeout,
  timedOut: () => boolean,
): AsyncGenerator<Uint8Array> {
  let total = 0;
  try {
    for await (const chunk of response) {
      total += (chunk as Buffer).length;
      if (total > maxBytes) throw coded('SIZE_LIMIT', `Response exceeds ${maxBytes} bytes`);
      yield chunk as Buffer;
    }
  } catch (error) {
    if (timedOut()) throw coded('URL_TIMEOUT', 'Fetch timed out');
    throw error;
  } finally {
    clearTimeout(timer);
    response.destroy();
  }
}
