import type { Duplex } from 'node:stream';
import type { BrowserExtensionPairing } from '../../protocol/src/browser.js';
import {
  rejectExtensionAuthentication,
  verifyExtensionPairing,
  type ExtensionPairingAuthOptions,
} from './extension-pairing-auth.js';
import { MAX_FRAME_BYTES, readFrames, WS_CONTINUATION, WS_CLOSE, WS_TEXT } from './ws-server.js';

export type ExtensionCloseCause =
  | 'remote_close'
  | 'remote_error'
  | 'protocol_error'
  | 'oversized_frame'
  | 'pairing_revoked'
  | 'server_stop';

const CAPTURE_STAGES = [
  'capture_started',
  'capture_api_done',
  'encode_done',
  'reply_send_attempt',
] as const;

export function isValidCaptureProgress(message: any, previousStage: string): boolean {
  const stage = CAPTURE_STAGES.indexOf(message.stage);
  const previous = CAPTURE_STAGES.indexOf(previousStage as (typeof CAPTURE_STAGES)[number]);
  return (
    stage >= 0 &&
    stage > previous &&
    Number.isInteger(message.elapsedMs) &&
    message.elapsedMs >= 0 &&
    message.elapsedMs <= 120_000 &&
    (message.bytes === undefined ||
      (Number.isInteger(message.bytes) && message.bytes >= 0 && message.bytes <= 1_000_000_000))
  );
}

interface ConnectionCallbacks {
  markClose: (cause: ExtensionCloseCause) => void;
  disconnected: () => void;
  oversized: () => void;
  authenticated: (pairing: BrowserExtensionPairing, profileName: string) => void;
  message: (message: any) => void;
}

export function attachExtensionConnection(
  socket: Duplex,
  originExtensionId: string,
  options: ExtensionPairingAuthOptions & { authTimeoutMs?: number },
  callbacks: ConnectionCallbacks,
): void {
  let authenticated = false;
  // Annotated: `Buffer.alloc` infers Buffer<ArrayBuffer>, but a decoded
  // remainder is Buffer<ArrayBufferLike> and would not assign back.
  let buffer: Buffer = Buffer.alloc(0);
  let fragments: Buffer[] | null = null;
  let fragmentedBytes = 0;
  const timer = setTimeout(() => {
    if (!authenticated) socket.destroy();
  }, options.authTimeoutMs ?? 3000);
  timer.unref?.();

  socket.on('error', () => {
    callbacks.markClose('remote_error');
    socket.destroy();
  });
  // Node's HTTP server keeps upgraded sockets half-open, so a peer's FIN
  // arrives as `end` and `close` never follows on its own.
  socket.on('end', () => {
    callbacks.markClose('remote_close');
    socket.destroy();
  });
  socket.on('close', () => {
    clearTimeout(timer);
    callbacks.disconnected();
  });
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    let read;
    try {
      read = readFrames(buffer);
    } catch {
      callbacks.oversized();
      return;
    }
    buffer = read.rest;
    // Cap only the unfinished frame. A single TCP chunk may contain several
    // complete legal frames, including progress followed by a large reply.
    if (buffer.length > MAX_FRAME_BYTES + 16) {
      callbacks.oversized();
      return;
    }
    for (const frame of read.frames) {
      if (frame.opcode === WS_CLOSE) {
        callbacks.markClose('remote_close');
        socket.destroy();
        return;
      }
      let payload: Buffer;
      if (frame.opcode === WS_TEXT) {
        if (fragments) {
          callbacks.markClose('protocol_error');
          socket.destroy();
          return;
        }
        if (!frame.fin) {
          fragments = [frame.payload];
          fragmentedBytes = frame.payload.length;
          continue;
        }
        payload = frame.payload;
      } else if (frame.opcode === WS_CONTINUATION) {
        if (!fragments) {
          callbacks.markClose('protocol_error');
          socket.destroy();
          return;
        }
        fragmentedBytes += frame.payload.length;
        if (fragmentedBytes > MAX_FRAME_BYTES) {
          callbacks.oversized();
          return;
        }
        fragments.push(frame.payload);
        if (!frame.fin) continue;
        payload = Buffer.concat(fragments, fragmentedBytes);
        fragments = null;
        fragmentedBytes = 0;
      } else {
        // Control frames may appear between fragments.
        continue;
      }
      let message: any;
      try {
        message = JSON.parse(payload.toString('utf8'));
      } catch {
        callbacks.markClose('protocol_error');
        socket.destroy();
        return;
      }
      if (!authenticated) {
        // One shot: the first frame either authenticates or the socket dies.
        // The peer is never told which check failed.
        const pairing =
          message?.type === 'auth'
            ? verifyExtensionPairing(
                options,
                String(message.token ?? ''),
                originExtensionId,
                typeof message.profileId === 'string' ? message.profileId : undefined,
              )
            : null;
        if (!pairing) {
          rejectExtensionAuthentication(socket);
          return;
        }
        authenticated = true;
        clearTimeout(timer);
        const profileName =
          typeof message.profileName === 'string' && message.profileName.trim()
            ? message.profileName.trim().slice(0, 120)
            : pairing.profileName;
        callbacks.authenticated(pairing, profileName);
        continue;
      }
      callbacks.message(message);
    }
  });
}
