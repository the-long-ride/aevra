import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { encodeFrame, FrameDecoder } from './framing.js';
import { handshakeMac } from './envelope.js';
import { socketLink } from './stream.js';
import { StreamTable } from './stream-table.js';
import { attachStream, type ServerStream, type StreamContext } from './stream-server.js';
export type { StreamContext } from './stream-server.js';
export interface RpcHandler {
  health(): Promise<{ ready: boolean; pid: number }>;
  /** `ctx` is present only when the caller opened a chunked stream with this request. */
  execute(envelope: unknown, ctx?: StreamContext): Promise<unknown>;
}
export function createIpcServer(
  _endpoint: string,
  secret: Buffer,
  daemonInstanceId: string,
  handler: RpcHandler,
) {
  const server = net.createServer((socket) => {
    let ready = false;
    let challengeB = '';
    const decoder = new FrameDecoder();
    const write = (frame: Record<string, unknown>) => {
      if (!socket.destroyed) socket.write(encodeFrame(frame));
    };
    const streams = new StreamTable(socketLink(() => socket));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => streams.abortAll('WORKER_DISCONNECTED'));
    /**
     * Answers one request without blocking the frames behind it.
     *
     * The decode loop used to `await` each handler inline, so a single long
     * `execute` - a build, a test run - stalled every other frame on the
     * connection, health probes included, for as long as it ran.
     */
    const dispatch = (f: any) => {
      if (typeof f.type === 'string' && f.type.startsWith('stream')) {
        streams.handle(f);
        return;
      }
      if (f.type === 'health') {
        void handler
          .health()
          .then((health) => write({ requestId: f.requestId, health }))
          .catch((error) => write({ requestId: f.requestId, error: String(error) }));
        return;
      }
      if (f.type === 'execute') {
        let stream: ServerStream | undefined;
        if (f.stream !== undefined) {
          stream = attachStream(streams, String(f.requestId), f.stream);
          if (!stream) {
            write({ requestId: f.requestId, error: 'invalid stream' });
            return;
          }
        }
        const run = stream ? handler.execute(f.envelope, stream.ctx) : handler.execute(f.envelope);
        void run
          .then(async (result) => {
            await stream?.beforeReply();
            write({ requestId: f.requestId, result });
            stream?.afterReply();
          })
          .catch(async (error) => {
            await stream?.beforeReply(error);
            write({ requestId: f.requestId, error: String(error) });
            stream?.afterReply();
          });
        return;
      }
      write({ requestId: f.requestId, error: 'unknown request' });
    };
    socket.on('data', (chunk) => {
      try {
        for (const f0 of decoder.push(chunk)) {
          const f = f0 as any;
          if (!ready) {
            if (
              f.type === 'hello' &&
              f.daemonInstanceId === daemonInstanceId &&
              typeof f.challengeA === 'string'
            ) {
              challengeB = randomBytes(16).toString('hex');
              write({
                type: 'helloAck',
                daemonInstanceId,
                challengeA: f.challengeA,
                challengeB,
                mac: handshakeMac(secret, daemonInstanceId, f.challengeA, challengeB),
              });
              continue;
            }
            if (
              f.type === 'ready' &&
              f.challengeB === challengeB &&
              f.mac === handshakeMac(secret, daemonInstanceId, challengeB)
            ) {
              ready = true;
              continue;
            }
            socket.destroy();
            return;
          }
          dispatch(f);
        }
      } catch {
        socket.destroy();
      }
    });
  });
  return server;
}
