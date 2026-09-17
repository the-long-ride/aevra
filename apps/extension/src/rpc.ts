import { RefRegistry } from '../../../packages/browser/src/dom-snapshot.js';
import {
  handleExtensionCommand,
  type ExtensionBridge,
} from '../../../packages/browser/src/extension-bridge.js';

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

interface Pairing {
  token: string;
  wsUrl: string;
}

async function readPairing(): Promise<Pairing | null> {
  const stored = await chrome.storage.local.get(['token', 'wsUrl']);
  if (typeof stored.token !== 'string' || typeof stored.wsUrl !== 'string') return null;
  return { token: stored.token, wsUrl: stored.wsUrl };
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

  constructor(private readonly bridge: ExtensionBridge) {}

  async connect(): Promise<void> {
    if (this.socket) return;
    const pairing = await readPairing();
    if (!pairing) return;

    const socket = new WebSocket(pairing.wsUrl);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.backoff = MIN_BACKOFF_MS;
      socket.send(JSON.stringify({ type: 'auth', token: pairing.token }));
    });
    socket.addEventListener('message', (event) => void this.receive(String(event.data)));
    socket.addEventListener('close', () => this.scheduleReconnect());
    socket.addEventListener('error', () => socket.close());
  }

  private scheduleReconnect(): void {
    this.socket = null;
    // Jittered so a worker restart storm does not synchronise reconnects.
    const delay = this.backoff * (0.5 + Math.random());
    this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
    setTimeout(() => void this.connect(), delay);
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
