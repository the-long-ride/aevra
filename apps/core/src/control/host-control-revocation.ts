import type { WorkerGateway } from '../../../../packages/mcp-tools/src/service-types.js';
import type { HostControlAccess } from './host-control-access.js';

export function installHostControlRevocation(
  access: HostControlAccess,
  worker: WorkerGateway,
): void {
  access.setRevocationHandler(async (identity, capability) => {
    if (capability !== 'desktop.control') return;
    const result = await worker.execute({
      sessionId: 'admin:host-control-revoke',
      workspaceId: '',
      scope: { kind: 'host-control', capability, identity },
      roots: [],
      operation: { kind: 'desktop.invalidateOwner' },
      executionMode: 'host',
    });
    if (!result.ok) throw new Error(result.error.message);
  });
}
