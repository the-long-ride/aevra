import { HmacEnvelopeSigner } from '../../../packages/ipc/src/envelope.js';
import { createIpcServer } from '../../../packages/ipc/src/server.js';
import { StreamError } from '../../../packages/ipc/src/stream.js';
import {
  parseOperationEnvelope,
  type WorkerResult,
} from '../../../packages/protocol/src/worker.js';
import { dispatchWorkerOperation } from './dispatcher.js';
import { browserRuntime } from './browser-runtime.js';
export async function startWorkerServer(input: {
  endpoint: string;
  secret: Buffer;
  browserTokenKey: Buffer;
  daemonInstanceId: string;
}) {
  const signer = new HmacEnvelopeSigner(input.secret, input.daemonInstanceId);
  browserRuntime.configure({ browserTokenKey: input.browserTokenKey });
  const server = createIpcServer(input.endpoint, input.secret, input.daemonInstanceId, {
    async health() {
      return { ready: true, pid: process.pid };
    },
    async execute(raw, ctx): Promise<WorkerResult> {
      try {
        const env = parseOperationEnvelope(raw);
        return await dispatchWorkerOperation(signer.verify(env), ctx);
      } catch (e) {
        // A stream abort carries its own code to the core; it is not an auth failure.
        if (e instanceof StreamError) throw e;
        return {
          ok: false,
          error: { code: 'UNAUTHORIZED', message: e instanceof Error ? e.message : String(e) },
        };
      }
    },
  });
  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(input.endpoint, res);
  });
  return server;
}
