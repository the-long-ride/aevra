import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { encodeFrame, FrameDecoder } from './framing.js';
import { handshakeMac } from './envelope.js';
export interface RpcHandler {
  health(): Promise<{ ready: boolean; pid: number }>;
  execute(envelope: unknown): Promise<unknown>;
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
    /**
     * Answers one request without blocking the frames behind it.
     *
     * The decode loop used to `await` each handler inline, so a single long
     * `execute` - a build, a test run - stalled every other frame on the
     * connection, health probes included, for as long as it ran.
     */
    const dispatch = (f: any) => {
      if (f.type === 'health') {
        void handler
          .health()
          .then((health) => write({ requestId: f.requestId, health }))
          .catch((error) => write({ requestId: f.requestId, error: String(error) }));
        return;
      }
      if (f.type === 'execute') {
        void handler
          .execute(f.envelope)
          .then((result) => write({ requestId: f.requestId, result }))
          .catch((error) => write({ requestId: f.requestId, error: String(error) }));
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
