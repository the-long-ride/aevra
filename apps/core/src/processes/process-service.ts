import type { WorkerGateway } from '../../../../packages/mcp-tools/src/service.js';
import type { WorkspaceService } from '../workspaces/workspace-service.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { ProcessRepository } from '../../../../packages/store/src/processes.js';
import type {
  CommandInput,
  ManagedProcessStatus,
  ProcessLifecycle,
} from '../../../../packages/protocol/src/index.js';

export class ProcessService {
  constructor(
    private sessions: SessionManager,
    private workspaces: WorkspaceService,
    private worker: WorkerGateway,
    private repo: ProcessRepository,
  ) {}

  async start(
    sessionId: string,
    workspaceIdOrCommand: string | CommandInput,
    commandOrLifecycle?: CommandInput | ProcessLifecycle,
    lifecycleOrName?: ProcessLifecycle | unknown,
    name?: unknown,
  ) {
    let workspaceId: string | undefined;
    let command: CommandInput;
    let lifecycle: ProcessLifecycle;
    let processName: unknown;

    if (typeof workspaceIdOrCommand === 'string') {
      workspaceId = workspaceIdOrCommand;
      command = commandOrLifecycle as CommandInput;
      lifecycle = (lifecycleOrName as ProcessLifecycle) ?? 'stop-with-aevra';
      processName = name;
    } else {
      command = workspaceIdOrCommand;
      workspaceId = (command as any)?.workspaceId;
      lifecycle = (commandOrLifecycle as ProcessLifecycle) ?? 'stop-with-aevra';
      processName = lifecycleOrName;
    }

    const l = this.leaseForWorkspace(sessionId, workspaceId);
    if (!l) {
      throw Object.assign(new Error('Workspace access required'), {
        code: 'WORKSPACE_ACCESS_REQUIRED',
      });
    }
    const safeProcessName = String(processName ?? '').trim() || undefined;
    const r = await this.worker.execute({
      sessionId,
      workspaceId: l.workspaceId,
      roots: this.workspaces.capabilityRoots(l.workspaceId),
      operation: { kind: 'process.start', command, lifecycle },
    });
    if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code });
    const child = r.value as ManagedProcessStatus;
    this.repo.put({
      id: child.processId,
      name: safeProcessName,
      workspaceId: l.workspaceId,
      lifecycle,
      ownership: 'owned',
      helperPid: child.pid,
      helperStartedAt: child.startedAt,
      marker: child.marker ?? 'worker-owned',
      command,
      executionMode: 'host',
      logPath: child.logPath,
      state: child.state,
      exitCode: child.exitCode,
      signal: child.signal,
      finishedAt: child.finishedAt,
    });
    return { ...this.remoteStatus(child), ...(safeProcessName ? { name: safeProcessName } : {}) };
  }

  listLocal() {
    return (this.repo.list() as any[]).map((r) => ({
      ...r,
      workspace_name: this.workspaces.getLocal(String(r.workspace_id))?.name ?? r.workspace_id,
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

  async list(sessionId: string, workspaceId?: string) {
    const l = this.leaseForWorkspace(sessionId, workspaceId);
    if (!l) {
      throw Object.assign(new Error('Workspace access required'), {
        code: 'WORKSPACE_ACCESS_REQUIRED',
      });
    }
    const records = this.repo.list(l.workspaceId) as any[];
    const known = new Set(records.map((record) => record.id));
    const observed = await this.worker.execute({
      sessionId,
      workspaceId: l.workspaceId,
      roots: this.workspaces.capabilityRoots(l.workspaceId),
      operation: { kind: 'process.list' },
    });
    if (observed.ok && Array.isArray(observed.value)) {
      for (const status of observed.value as ManagedProcessStatus[]) {
        if (known.has(status.processId)) this.repo.updateStatus(status);
      }
    }
    return (this.repo.list(l.workspaceId) as any[]).map((record) => this.remoteRecord(record));
  }

  async status(sessionId: string, workspaceIdOrProcessId: string, maybeProcessId?: string) {
    const workspaceId = maybeProcessId ? workspaceIdOrProcessId : undefined;
    const processId = maybeProcessId ?? workspaceIdOrProcessId;
    return this.observe(sessionId, processId, { kind: 'process.status', processId }, workspaceId);
  }

  async wait(
    sessionId: string,
    workspaceIdOrProcessId: string,
    maybeProcessIdOrTimeout?: string | number,
    maybeTimeoutMs?: number,
  ) {
    let workspaceId: string | undefined;
    let processId: string;
    let timeoutMs: number | undefined;
    if (typeof maybeProcessIdOrTimeout === 'string') {
      workspaceId = workspaceIdOrProcessId;
      processId = maybeProcessIdOrTimeout;
      timeoutMs = maybeTimeoutMs;
    } else {
      processId = workspaceIdOrProcessId;
      timeoutMs = maybeProcessIdOrTimeout;
    }
    return this.observe(
      sessionId,
      processId,
      { kind: 'process.wait', processId, timeoutMs },
      workspaceId,
    );
  }

  async command(
    sessionId: string,
    workspaceIdOrKind: string,
    kindOrProcessId: 'process.logs' | 'process.stop' | 'process.restart' | string,
    processIdOrCursor?: string,
    cursor?: string,
  ) {
    let workspaceId: string | undefined;
    let kind: 'process.logs' | 'process.stop' | 'process.restart';
    let processId: string;
    let cur: string | undefined;

    if (workspaceIdOrKind.startsWith('process.')) {
      kind = workspaceIdOrKind as any;
      processId = kindOrProcessId as string;
      cur = processIdOrCursor;
    } else {
      workspaceId = workspaceIdOrKind;
      kind = kindOrProcessId as any;
      processId = processIdOrCursor as string;
      cur = cursor;
    }

    const record = this.repo.get(processId);
    if (!record) throw new Error('process not found');
    if (workspaceId && record.workspace_id !== workspaceId) {
      throw new Error('process not in active workspace');
    }
    const l = this.leaseForWorkspace(sessionId, record.workspace_id);
    if (!l) {
      throw Object.assign(new Error('Workspace access required'), {
        code: 'WORKSPACE_ACCESS_REQUIRED',
      });
    }
    const result = await this.worker.execute({
      sessionId,
      workspaceId: l.workspaceId,
      roots: this.workspaces.capabilityRoots(l.workspaceId),
      operation:
        kind === 'process.logs' ? { kind, processId, cursor: cur } : ({ kind, processId } as any),
    });
    if (result.ok && kind === 'process.logs') this.reconcileValue(result.value);
    if (result.ok && kind === 'process.restart') {
      const child = result.value as ManagedProcessStatus;
      this.repo.delete(processId);
      this.repo.put({
        id: child.processId,
        name: record.name ?? undefined,
        workspaceId: l.workspaceId,
        lifecycle: record.lifecycle,
        ownership: 'owned',
        helperPid: child.pid,
        helperStartedAt: child.startedAt,
        marker: child.marker ?? 'worker-owned',
        command: JSON.parse(record.command_json),
        executionMode: record.execution_mode,
        logPath: child.logPath,
        state: child.state,
        exitCode: child.exitCode,
        signal: child.signal,
        finishedAt: child.finishedAt,
      });
      return {
        ...result,
        value: {
          ...this.remoteStatus(child),
          ...(record.name ? { name: record.name } : {}),
        },
      };
    }
    return result;
  }

  private async observe(
    sessionId: string,
    processId: string,
    operation: any,
    workspaceId?: string,
  ) {
    const record = this.repo.get(processId);
    if (!record) throw new Error('process not found');
    if (workspaceId && record.workspace_id !== workspaceId) {
      throw new Error('process not in active workspace');
    }
    const l = this.leaseForWorkspace(sessionId, record.workspace_id);
    if (!l) {
      throw Object.assign(new Error('Workspace access required'), {
        code: 'WORKSPACE_ACCESS_REQUIRED',
      });
    }
    const result = await this.worker.execute({
      sessionId,
      workspaceId: l.workspaceId,
      roots: this.workspaces.capabilityRoots(l.workspaceId),
      operation,
    });
    if (!result.ok) return result;
    this.reconcileValue(result.value);
    return {
      ...result,
      value: {
        ...this.remoteStatus(result.value as ManagedProcessStatus),
        ...(record.name ? { name: record.name } : {}),
      },
    };
  }

  private reconcileValue(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const status = value as Partial<ManagedProcessStatus>;
    if (!status.processId || !status.state) return;
    this.repo.updateStatus(status as ManagedProcessStatus);
  }

  private remoteStatus(status: ManagedProcessStatus): ManagedProcessStatus {
    const { logPath: _logPath, resultPath: _resultPath, ...safe } = status;
    return safe;
  }

  private remoteRecord(record: any): ManagedProcessStatus {
    const startedAt = record.helper_started_at ?? record.created_at;
    const finishedAt = record.finished_at ?? null;
    return {
      processId: record.id,
      ...(record.name ? { name: record.name } : {}),
      pid: record.helper_pid ?? 0,
      startedAt,
      lifecycle: record.lifecycle,
      state: record.state ?? 'unknown',
      exitCode: record.exit_code ?? null,
      signal: record.signal ?? null,
      finishedAt,
      durationMs: finishedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) : null,
      ...(record.marker ? { marker: record.marker } : {}),
    };
  }

  private leaseForWorkspace(sessionId: string, workspaceId?: string) {
    if (workspaceId && typeof (this.sessions as any).leaseForWorkspace === 'function') {
      return this.sessions.leaseForWorkspace(sessionId, workspaceId);
    }
    const l = this.sessions.activeLease(sessionId);
    if (!l) return null;
    if (workspaceId && l.workspaceId !== workspaceId) return null;
    return l;
  }
}
