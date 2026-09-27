import { RefRegistry } from '../../../packages/browser/src/dom-snapshot.js';
import { MAX_FRAME_BYTES } from '../../../packages/browser/src/frame-limits.js';
import {
  handleExtensionCommand,
  type CaptureProgress,
  type ExtensionBridge,
} from '../../../packages/browser/src/extension-bridge.js';
import { probeListener, type ListenerProbe } from './listener-probe.js';

export const MIN_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 30_000;
const KEEPALIVE_INTERVAL_MS = 20_000;
export type ExtensionConnectionState =
  'unpaired' | 'paused' | 'connecting' | 'connected' | 'standby' | 'pair-again';
export interface ExtensionConnectionStatus {
  state: ExtensionConnectionState;
  lastErrorCode: string | null;
  lastChangedAt: string;
}

interface Pairing {
  token: string;
  wsUrl: string;
  profileId?: string;
  profileName?: string;
}

async function readPairing(): Promise<{ pairing: Pairing | null; paused: boolean }> {
  const stored = await chrome.storage.local.get([
    'token',
    'wsUrl',
    'enabled',
    'profileName',
    'pairedProfileId',
  ]);
  if (stored.enabled === false) return { pairing: null, paused: true };
  if (typeof stored.token !== 'string' || typeof stored.wsUrl !== 'string')
    return { pairing: null, paused: false };
  const pairing: Pairing = { token: stored.token, wsUrl: stored.wsUrl };
  if (typeof stored.pairedProfileId === 'string' && stored.pairedProfileId.trim()) {
    pairing.profileId = stored.pairedProfileId.trim();
  }
  if (typeof stored.profileName === 'string' && stored.profileName.trim().length > 0) {
    pairing.profileName = stored.profileName.trim();
  }
  return { pairing, paused: false };
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
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private manualDisconnect = false;
  private authenticated = false;
  private probing = false;
  /** One warning per outage, not one per backoff tick. */
  private warnedUnreachable = false;
  private state: ExtensionConnectionStatus = {
    state: 'unpaired',
    lastErrorCode: null,
    lastChangedAt: new Date().toISOString(),
  };

  constructor(private readonly bridge: ExtensionBridge) {}

  status(): ExtensionConnectionStatus {
    return { ...this.state };
  }

  private setState(state: ExtensionConnectionState, lastErrorCode: string | null = null): void {
    if (this.state.state === state && this.state.lastErrorCode === lastErrorCode) return;
    this.state = { state, lastErrorCode, lastChangedAt: new Date().toISOString() };
  }

  isConnected(): boolean {
    return (
      this.authenticated &&
      this.state.state === 'connected' &&
      this.socket?.readyState === WebSocket.OPEN
    );
  }

  resetAttempts(): void {
    this.backoff = MIN_BACKOFF_MS;
  }

  newPairing(): void {
    this.stopKeepalive();
    if (this.socket) {
      const previous = this.socket;
      this.socket = null;
      this.authenticated = false;
      previous.close();
    }
    this.setState('connecting');
    this.manualDisconnect = false;
    void this.connect(true);
  }

  disconnect(): void {
    this.manualDisconnect = true;
    this.authenticated = false;
    this.stopKeepalive();
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
        /* already closing */
      }
    }
    this.setState('paused');
  }

  async connect(force = false): Promise<void> {
    if (this.state.state === 'pair-again') return;
    if (force) this.manualDisconnect = false;
    if (force && this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Claimed before the first await: two callers racing through the reads
    // below would otherwise each probe and each dial.
    if (this.socket || this.probing) return;
    this.probing = true;
    let pairing: Pairing | null;
    let probe: ListenerProbe;
    try {
      const read = await readPairing();
      pairing = read.pairing;
      if (this.manualDisconnect || this.status().state === 'pair-again') return;
      if (!pairing) {
        this.setState(read.paused ? 'paused' : 'unpaired');
        return;
      }
      this.setState('connecting', this.state.lastErrorCode);
      // Chrome logs every refused WebSocket as an extension error it will not
      // let us catch, so an Aevra that is simply not running is probed first.
      probe = await probeListener(pairing.wsUrl);
    } finally {
      this.probing = false;
    }
    if (this.socket || this.manualDisconnect || this.status().state === 'pair-again') return;
    if (probe === 'down') {
      if (!this.warnedUnreachable) {
        this.warnedUnreachable = true;
        console.warn(`Aevra is not reachable at ${pairing.wsUrl}; retrying until it starts.`);
      }
      this.setState('connecting', 'LISTENER_UNAVAILABLE');
      this.scheduleReconnect();
      return;
    }
    this.warnedUnreachable = false;
    const socket = new WebSocket(pairing.wsUrl);
    this.socket = socket;
    this.authenticated = false;
    let authSubmitted = false;

    socket.addEventListener('open', () => {
      if (this.socket !== socket || this.manualDisconnect) return;
      const authFrame: { type: string; token: string; profileId?: string; profileName?: string } = {
        type: 'auth',
        token: pairing.token,
      };
      if (pairing.profileId) authFrame.profileId = pairing.profileId;
      if (pairing.profileName) authFrame.profileName = pairing.profileName;
      socket.send(JSON.stringify(authFrame));
      authSubmitted = true;
    });
    socket.addEventListener('message', (event) => {
      if (this.socket === socket) void this.receive(String(event.data));
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.stopKeepalive();
      const wasAuthenticated = this.authenticated;
      this.socket = null;
      this.authenticated = false;
      if (this.manualDisconnect) return;
      if (this.state.state === 'pair-again') return;
      if (authSubmitted && !wasAuthenticated) {
        this.setState('pair-again', 'AUTH_UNACKNOWLEDGED');
        return;
      }
      this.setState('connecting', 'LISTENER_UNAVAILABLE');
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => socket.close());
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || this.state.state === 'pair-again' || this.reconnectTimer) return;
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
    if (message?.type === 'auth_ok') {
      this.authenticated = true;
      this.resetAttempts();
      this.setState('connected');
      if (this.socket) this.startKeepalive(this.socket);
      return;
    }
    if (message?.type === 'auth_standby') {
      this.authenticated = true;
      this.setState('standby');
      if (this.socket) this.startKeepalive(this.socket);
      return;
    }
    if (message?.type === 'auth_error' && message?.code === 'AUTH_REJECTED') {
      this.authenticated = false;
      this.stopKeepalive();
      this.setState('pair-again', 'AUTH_REJECTED');
      this.socket?.close();
      return;
    }
    if (!this.authenticated) return;
    if (this.state.state !== 'connected') return;
    if (message?.type === 'cancel') {
      this.cancelled.add(String(message.id));
      return;
    }
    if (message?.type !== 'cmd') return;

    const id = String(message.id);
    const commandSocket = this.socket;
    const vision = message.op === 'snapshot' && message.params?.mode === 'vision';
    const started = performance.now();
    const sendProgress = (progress: CaptureProgress) => {
      if (
        !vision ||
        !commandSocket ||
        this.socket !== commandSocket ||
        commandSocket.readyState !== WebSocket.OPEN ||
        this.cancelled.has(id)
      )
        return;
      try {
        commandSocket.send(JSON.stringify({ type: 'capture_progress', id, ...progress }));
      } catch {
        // Diagnostics must never turn a capture into a failure.
      }
    };
    const beforeReply = () =>
      sendProgress({
        stage: 'reply_send_attempt',
        elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      });
    try {
      const payload = await handleExtensionCommand(
        this.registry,
        this.bridge,
        {
          op: message.op,
          params: message.params ?? {},
        },
        sendProgress,
        () =>
          this.cancelled.has(id) ||
          this.socket !== commandSocket ||
          commandSocket?.readyState !== WebSocket.OPEN,
      );
      if (vision) beforeReply();
      this.reply(id, { id, type: 'result', payload }, commandSocket);
    } catch (error) {
      if (vision) beforeReply();
      this.reply(
        id,
        {
          id,
          type: 'error',
          payload: {
            code: (error as { code?: string }).code ?? 'BROWSER_UNAVAILABLE',
            message: error instanceof Error ? error.message : String(error),
          },
        },
        commandSocket,
      );
    }
  }

  private reply(id: string, payload: unknown, socket: WebSocket | null): void {
    if (this.cancelled.delete(id)) return;
    if (!socket || this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
    let frame = JSON.stringify(payload);
    // The worker refuses an oversized frame on its header and drops the socket,
    // so sending one anyway loses the reply and the connection together.
    if (new TextEncoder().encode(frame).length > MAX_FRAME_BYTES) {
      frame = JSON.stringify({
        id,
        type: 'error',
        payload: {
          code: 'BROWSER_REPLY_TOO_LARGE',
          message: `The reply exceeded the ${MAX_FRAME_BYTES}-byte frame limit`,
        },
      });
    }
    socket.send(frame);
  }

  private startKeepalive(socket: WebSocket): void {
    this.stopKeepalive();
    // Keep the MV3 worker active during browser capture.
    this.keepaliveTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN || !this.authenticated) {
        this.stopKeepalive();
        return;
      }
      try {
        socket.send(JSON.stringify({ type: 'keepalive' }));
      } catch {
        this.stopKeepalive();
        socket.close();
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (!this.keepaliveTimer) return;
    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }
}
