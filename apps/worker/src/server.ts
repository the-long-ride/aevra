import { HmacEnvelopeSigner } from '../../../packages/ipc/src/envelope.js';
import { createIpcServer } from '../../../packages/ipc/src/server.js';
import {
  parseOperationEnvelope,
  type WorkerResult,
} from '../../../packages/protocol/src/worker.js';
import { dispatchWorkerOperation } from './dispatcher.js';
export async function startWorkerServer(input: {
  endpoint: string;
  secret: Buffer;
  daemonInstanceId: string;
}) {
  const signer = new HmacEnvelopeSigner(input.secret, input.daemonInstanceId);
  const server = createIpcServer(input.endpoint, input.secret, input.daemonInstanceId, {
    async health() {
      return { ready: true, pid: process.pid };
    },
    async execute(raw): Promise<WorkerResult> {
      try {
        const env = parseOperationEnvelope(raw);
        return await dispatchWorkerOperation(signer.verify(env));
      } catch (e) {
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
