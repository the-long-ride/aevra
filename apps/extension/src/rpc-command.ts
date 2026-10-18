import { MAX_FRAME_BYTES } from '../../../packages/browser/src/frame-limits.js';
import {
  handleExtensionCommand,
  type CaptureProgress,
  type ExtensionBridge,
} from '../../../packages/browser/src/extension-bridge.js';
import type { RefRegistry } from '../../../packages/browser/src/dom-snapshot.js';

interface CommandContext {
  registry: RefRegistry;
  bridge: ExtensionBridge;
  cancelled: Set<string>;
  currentSocket(): WebSocket | null;
}

export async function receiveCommand(message: any, context: CommandContext): Promise<void> {
  const id = String(message.id);
  const commandSocket = context.currentSocket();
  const vision = message.op === 'snapshot' && message.params?.mode === 'vision';
  const started = performance.now();
  const sendProgress = (progress: CaptureProgress) => {
    if (
      !vision ||
      !commandSocket ||
      context.currentSocket() !== commandSocket ||
      commandSocket.readyState !== WebSocket.OPEN ||
      context.cancelled.has(id)
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
      context.registry,
      context.bridge,
      {
        op: message.op,
        params: message.params ?? {},
      },
      sendProgress,
      () =>
        context.cancelled.has(id) ||
        context.currentSocket() !== commandSocket ||
        commandSocket?.readyState !== WebSocket.OPEN,
    );
    if (vision) beforeReply();
    reply(id, { id, type: 'result', payload }, commandSocket);
  } catch (error) {
    if (vision) beforeReply();
    reply(
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
  function reply(id: string, payload: unknown, socket: WebSocket | null): void {
    if (context.cancelled.delete(id)) return;
    if (!socket || context.currentSocket() !== socket || socket.readyState !== WebSocket.OPEN)
      return;
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
}
