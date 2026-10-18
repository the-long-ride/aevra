export interface SelectedServer {
  token: string;
  wsUrl: string;
  pairingOrigin: string;
  pairingPort: number;
  serverName: string;
}

/** Pairing credentials may only target a loopback WebSocket listener. */
export function validatePairingResponse(
  input: unknown,
  port: number,
  scheme: 'http' | 'https',
): SelectedServer | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (
    typeof value.token !== 'string' ||
    !value.token.trim() ||
    value.token.length > 16_384 ||
    typeof value.wsUrl !== 'string'
  )
    return null;
  try {
    const url = new URL(value.wsUrl);
    if (
      !['ws:', 'wss:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      return null;
    return {
      token: value.token,
      wsUrl: value.wsUrl,
      pairingOrigin: `${scheme}://127.0.0.1:${port}`,
      pairingPort: port,
      serverName:
        port === 47841 ? 'Aevra Browser' : port === 47831 ? 'Aevra' : `Aevra on port ${port}`,
    };
  } catch {
    return null;
  }
}

export function matchesPairingOrigin(page: string, saved: Record<string, unknown>): boolean {
  try {
    const origin = new URL(page).origin;
    const expected = typeof saved.pairingOrigin === 'string' ? new URL(saved.pairingOrigin) : null;
    if (expected) {
      const current = new URL(page);
      return (
        current.protocol === expected.protocol &&
        current.port === expected.port &&
        ['localhost', '127.0.0.1'].includes(current.hostname) &&
        ['localhost', '127.0.0.1'].includes(expected.hostname)
      );
    }
    // Existing installations did not persist the pairing origin. Derive only known defaults.
    const ws = typeof saved.wsUrl === 'string' ? new URL(saved.wsUrl) : null;
    const port = ws?.port === '47843' ? '47841' : ws?.port === '47833' ? '47831' : null;
    return (
      !!port &&
      ['http:', 'https:'].includes(new URL(page).protocol) &&
      ['localhost', '127.0.0.1'].includes(new URL(page).hostname) &&
      new URL(page).port === port &&
      !!origin
    );
  } catch {
    return false;
  }
}
