import type { WorkerGateway } from '../../../../packages/mcp-tools/src/service.js';
import type { WorkspaceService } from '../workspaces/workspace-service.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { ProcessRepository } from '../../../../packages/store/src/processes.js';
import type { CommandInput, ProcessLifecycle } from '../../../../packages/protocol/src/index.js';
export class ProcessService {
  constructor(
    private sessions: SessionManager,
    private workspaces: WorkspaceService,
    private worker: WorkerGateway,
    private repo: ProcessRepository,
  ) {}
  async start(sessionId: string, command: CommandInput, lifecycle: ProcessLifecycle) {
    const l = this.requiredLease(sessionId);
    const r = await this.worker.execute({
      sessionId,
      workspaceId: l.workspaceId,
      roots: this.workspaces.capabilityRoots(l.workspaceId),
      operation: { kind: 'process.start', command, lifecycle },
    });
    if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code });
    const child = r.value as any;
    this.repo.put({
      id: child.processId,
      workspaceId: l.workspaceId,
      lifecycle,
      ownership: 'owned',
      helperPid: child.pid,
      helperStartedAt: child.startedAt,
      marker: child.marker ?? 'worker-owned',
      command,
      executionMode: 'host',
      logPath: child.logPath,
    });
    return child;
  }
  listLocal() {
    return (this.repo.list() as any[]).map((r) => ({
      ...r,
      command: r.command_json ? JSON.parse(r.command_json) : r.command,
    }));
  }
  async localAction(processId: string, action: 'stop' | 'restart' | 'forget') {
    const record = this.repo.get(processId);
    if (!record) throw new Error('process not found');
    if (action === 'forget') {
      this.repo.delete(processId);
      return { forgotten: true };
    }
    if (record.ownership === 'detached-uncertain')
      throw Object.assign(
        new Error(
          'Detached process ownership is uncertain; explicitly reattach or forget before control',
        ),
        { code: 'PROCESS_OWNERSHIP_UNCERTAIN' },
      );
    const kind = action === 'stop' ? 'process.stop' : 'process.restart';
    const r = await this.worker.execute({
      sessionId: 'local-admin',
      workspaceId: record.workspace_id,
      roots: this.workspaces.capabilityRoots(record.workspace_id),
      operation: { kind, processId } as any,
      executionMode: 'host',
    });
    if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code });
    return r.value;
  }
  async list(sessionId: string) {
    const l = this.requiredLease(sessionId);
    return this.repo.list(l.workspaceId);
  }
  async command(
    sessionId: string,
    kind: 'process.logs' | 'process.stop' | 'process.restart',
    processId: string,
    cursor?: string,
  ) {
    const l = this.requiredLease(sessionId);
    const record = (this.repo.list(l.workspaceId) as any[]).find((x) => x.id === processId);
    if (!record) throw new Error('process not in active workspace');
    return this.worker.execute({
      sessionId,
      workspaceId: l.workspaceId,
      roots: this.workspaces.capabilityRoots(l.workspaceId),
      operation:
        kind === 'process.logs' ? { kind, processId, cursor } : ({ kind, processId } as any),
    });
  }
  private requiredLease(sessionId: string) {
    const l = this.sessions.activeLease(sessionId);
    if (!l)
      throw Object.assign(new Error('Select workspace'), { code: 'SESSION_WORKSPACE_REQUIRED' });
    return l;
  }
}
