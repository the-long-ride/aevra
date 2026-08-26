import type { WorkerGateway } from '../../../packages/mcp-tools/src/service.js';

export function unavailableWorkerGateway(): WorkerGateway {
  return {
    async execute() {
      return {
        ok: false,
        error: { code: 'EXECUTOR_UNAVAILABLE', message: 'Execution Worker unavailable' },
      } as any;
    },
  };
}
