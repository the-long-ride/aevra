import { RefRegistry } from '../../../packages/browser/src/dom-snapshot.js';
import {
  handleExtensionCommand,
  type ExtensionBridge,
} from '../../../packages/browser/src/extension-bridge.js';

export const MIN_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 30_000;
export const MAX_RECONNECT_ATTEMPTS = 3;

interface Pairing {
  token: string;
  wsUrl: string;
  profileName?: string;
}

async function readPairing(): Promise<Pairing | null> {
  const stored = await chrome.storage.local.get(['token', 'wsUrl', 'enabled', 'profileName']);
  if (stored.enabled === false) return null;
  if (typeof stored.token !== 'string' || typeof stored.wsUrl !== 'string') return null;
  const pairing: Pairing = { token: stored.token, wsUrl: stored.wsUrl };
  if (typeof stored.profileName === 'string' && stored.profileName.trim().length > 0) {
    pairing.profileName = stored.profileName.trim();
  }
  return pairing;
}

/**
 * Owns the socket to the Aevra worker.
 *
 * MV3 service workers cannot set request headers, so the token is sent as the
 * first frame. An unpaired extension stays idle and connects nothing.
 */
export class ExtensionRpc {
  private socket: WebSocket | null = null;
  private backoff = MIN_BACKOFF_MS;
  private readonly cancelled = new Set<string>();
  private readonly registry = new RefRegistry();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualDisconnect = false;
  private reconnectAttempts = 0;

  constructor(private readonly bridge: ExtensionBridge) {}

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  resetAttempts(): void {
    this.reconnectAttempts = 0;
    this.backoff = MIN_BACKOFF_MS;
  }

  disconnect(): void {
    this.manualDisconnect = true;
    this.resetAttempts();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
  }

  async connect(force = false): Promise<void> {
    if (force) {
      this.resetAttempts();
    }
    this.manualDisconnect = false;
    if (this.socket) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }
    const pairing = await readPairing();
    if (!pairing) return;

    const socket = new WebSocket(pairing.wsUrl);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.resetAttempts();
      const authFrame: { type: string; token: string; profileName?: string } = {
        type: 'auth',
        token: pairing.token,
      };
      if (pairing.profileName) {
        authFrame.profileName = pairing.profileName;
      }
      socket.send(JSON.stringify(authFrame));
    });
    socket.addEventListener('message', (event) => void this.receive(String(event.data)));
    socket.addEventListener('close', () => {
      if (!this.manualDisconnect) {
        this.scheduleReconnect();
      }
    });
    socket.addEventListener('error', () => socket.close());
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect) return;
    this.socket = null;
    this.reconnectAttempts++;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Jittered so a worker restart storm does not synchronise reconnects.
    const delay = this.backoff * (0.5 + Math.random());
    this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private async receive(raw: string): Promise<void> {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message?.type === 'cancel') {
      this.cancelled.add(String(message.id));
      return;
    }
    if (message?.type !== 'cmd') return;

    const id = String(message.id);
    try {
      const payload = await handleExtensionCommand(this.registry, this.bridge, {
        op: message.op,
        params: message.params ?? {},
      });
      this.reply(id, { id, type: 'result', payload });
    } catch (error) {
      this.reply(id, {
        id,
        type: 'error',
        payload: {
          code: (error as { code?: string }).code ?? 'BROWSER_UNAVAILABLE',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private reply(id: string, payload: unknown): void {
    if (this.cancelled.delete(id)) return;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }
}
