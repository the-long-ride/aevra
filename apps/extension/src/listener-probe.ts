/** How long a reachability probe may take before the socket is tried anyway. */
const PROBE_TIMEOUT_MS = 2000;

export type ListenerProbe = 'up' | 'down' | 'unknown';

/** The listener's own origin over HTTP; it answers plain requests with 426. */
export function probeUrl(wsUrl: string): string {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * Asks whether anything is listening before a WebSocket is opened.
 *
 * Chrome logs every failed `new WebSocket()` as an error on the extension's
 * error page, and no handler can catch or silence it. So while Aevra is not
 * running, each reconnect attempt used to add another
 * `ERR_CONNECTION_REFUSED` error. A refused `fetch` is an ordinary rejected
 * promise, so the extension probes first and opens the socket only when the
 * listener may be there.
 *
 * Only an explicit refusal counts as `down`. Browsers also use a generic
 * TypeError for blocked HTTP responses and other fetch failures; those are
 * `unknown` so a reachable WebSocket is still tried. A timeout is likewise
 * unknown because older Aevra builds may not answer plain HTTP.
 */
export async function probeListener(wsUrl: string): Promise<ListenerProbe> {
  let target: string;
  try {
    target = probeUrl(wsUrl);
  } catch {
    return 'unknown';
  }
  try {
    await fetch(target, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return 'up';
  } catch (error) {
    const failure = error as { code?: unknown; cause?: { code?: unknown } } | null;
    const code = failure?.code ?? failure?.cause?.code;
    return code === 'ECONNREFUSED' || code === 'ERR_CONNECTION_REFUSED' ? 'down' : 'unknown';
  }
}
