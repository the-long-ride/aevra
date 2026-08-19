import { randomUUID } from 'node:crypto';
import type { ReadVersionCache } from './read-version-cache.js';
import type { WorkspaceService } from '../workspaces/workspace-service.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { WorkerGateway } from '../../../../packages/mcp-tools/src/service.js';
import type { OperationRepository } from '../../../../packages/store/src/operations.js';
import type { AuditService } from '../audit/audit-service.js';
import { mergeText } from './merge.js';
import { WorkspaceLockCoordinator } from '../policy/workspace-locks.js';
import { classifyCommand } from '../policy/command-family.js';
import type { Capability, CommandEffect, NetworkPolicy } from '../../../../packages/protocol/src/index.js';
import type { ChangeSetService } from '../changes/change-service.js';
import { classifyNetworkDestination } from '../policy/network.js';
import { createFileMutation, deleteFileMutation, moveFileMutation, patchFileMutation } from './file-mutations.js';
import { drainActiveCommands } from './command-drain.js';

export interface AuthorizedCapabilityContext {
  sessionId: string;
  workspaceId: string;
  actor: string;
  capability: Capability;
  matcher: string;
}

export class OperationService {
  private recoveryReady = false;
  private changes?: ChangeSetService;
  private activeCommands = new Map<string, Set<Promise<unknown>>>();
  private commandEffectResolver?: (family: string, defaultEffect: CommandEffect) => CommandEffect;
  private executionSettingsResolver?: () => {
    sandboxBackend?: 'auto' | 'docker' | 'podman' | 'native';
    cachePolicy?: 'shared' | 'workspace' | 'disabled';
  };

  constructor(
    private sessions: SessionManager,
    private workspaces: WorkspaceService,
    private worker: WorkerGateway,
    private operations: OperationRepository,
    private audit: AuditService,
    private reads: ReadVersionCache,
    private locks = new WorkspaceLockCoordinator(),
  ) {}

  setCommandEffectResolver(
    resolver: (family: string, defaultEffect: CommandEffect) => CommandEffect,
  ) {
    this.commandEffectResolver = resolver;
  }

  setExecutionSettingsResolver(
    resolver: () => {
      sandboxBackend?: 'auto' | 'docker' | 'podman' | 'native';
      cachePolicy?: 'shared' | 'workspace' | 'disabled';
    },
  ) {
    this.executionSettingsResolver = resolver;
  }

  classify(tokens: string[]) {
    const result = classifyCommand(tokens);
    return {
      ...result,
      effect: this.commandEffectResolver?.(result.family, result.effect) ?? result.effect,
    };
  }

  classifyNetwork(value: string) {
    return classifyNetworkDestination(value);
  }

  attachChangeService(changes: ChangeSetService) {
    this.changes = changes;
    this.recoveryReady = true;
  }

  setRecoveryReady(v = true) {
    this.recoveryReady = v;
  }

  async write(
    sessionId: string,
    input: { path: string; content: string; expectedHash?: string },
    authorization?: AuthorizedCapabilityContext,
  ) {
    const lease = this.requiredLease(sessionId, 'files.write', authorization);
    const roots = this.workspaces.capabilityRoots(lease.workspaceId);
    const current = await this.worker.execute({
      sessionId,
      workspaceId: lease.workspaceId,
      roots,
      operation: { kind: 'file.read', path: input.path },
    });
    if (!current.ok) {
      throw Object.assign(new Error(current.error.message), { code: current.error.code });
    }
    const cur = current.value as any;
    let content = input.content;
    if (input.expectedHash && input.expectedHash !== cur.hash) {
      const base = this.reads.get(sessionId, lease.workspaceId, cur.path, input.expectedHash);
      if (!base) {
        throw Object.assign(new Error('Stale write base unavailable'), {
          code: 'WRITE_CONFLICT',
        });
      }
      const merged = mergeText(base.content, cur.content, input.content);
      if (merged.kind === 'conflict') {
        throw Object.assign(new Error('Overlapping edits'), {
          code: 'MERGE_CONFLICT',
          ranges: merged.ranges,
        });
      }
      content = merged.content;
    }
    const operationId = `op_${randomUUID()}`;
    this.operations.put({
      id: operationId,
      sessionId,
      workspaceId: lease.workspaceId,
      kind: 'file.write',
      state: 'PREPARING',
      intent: { path: input.path },
      expectedState: { beforeHash: cur.hash },
    });
    const recovery = await this.changes!.snapshot(
      sessionId,
      lease.workspaceId,
      input.path,
      operationId,
    );
    this.operations.updateState(operationId, 'AUTHORIZED', {
      snapshotPath: recovery.snapshotPath,
    });
    const ticket = await this.locks.acquire({
      operationId,
      sessionId,
      workspaceId: lease.workspaceId,
      effect: 'SOURCE_MUTATION',
      outputKeys: [],
    });
    try {
      this.operations.updateState(operationId, 'EXECUTING');
      const result = await this.worker.execute({
        sessionId,
        workspaceId: lease.workspaceId,
        roots,
        operation: { kind: 'file.write', path: input.path, content, encoding: 'utf8' },
        expectedState: { beforeHash: cur.hash },
      });
      if (!result.ok) {
        throw Object.assign(new Error(result.error.message), { code: result.error.code });
      }
      const afterHash = (result.value as any).hash;
      await this.changes!.recordMutation({
        changeSetId: recovery.changeSet.id,
        operationId,
        logicalPath: input.path,
        beforeHash: cur.hash,
        afterHash,
        snapshotPath: recovery.snapshotPath,
        metadata: { autoMerged: content !== input.content },
      } as any);
      this.operations.updateState(operationId, 'SUCCEEDED', result.value);
      this.audit.append({
        sessionId,
        workspaceId: lease.workspaceId,
        operation: 'file:write',
        risk: 'LOW',
        result: 'SUCCEEDED',
        changeSetId: recovery.changeSet.id,
        redactionCount: 0,
      });
      return result.value;
    } catch (error) {
      this.operations.updateState(operationId, 'FAILED', {
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      ticket.release();
    }
  }

  async create(
    sessionId: string,
    input: { path: string; content: string; encoding: 'utf8' | 'base64' },
    authorization?: AuthorizedCapabilityContext,
  ) {
    const lease = this.requiredLease(sessionId, 'files.write', authorization);
    return createFileMutation(this.mutationDeps(), sessionId, lease, input);
  }

  async delete(
    sessionId: string,
    input: { path: string; recursive: boolean },
    authorization?: AuthorizedCapabilityContext,
  ) {
    const lease = this.requiredLease(sessionId, 'files.delete', authorization);
    return deleteFileMutation(this.mutationDeps(), sessionId, lease, input);
  }

  async move(
    sessionId: string,
    input: { from: string; to: string },
    authorization?: AuthorizedCapabilityContext,
  ) {
    const lease = this.requiredLease(sessionId, 'files.write', authorization);
    return moveFileMutation(this.mutationDeps(), sessionId, lease, input);
  }

  async patch(
    sessionId: string,
    input: { path: string; patch: string; expectedHash?: string },
    authorization?: AuthorizedCapabilityContext,
  ) {
    const lease = this.requiredLease(sessionId, 'files.write', authorization);
    return patchFileMutation(
      { workspaces: this.workspaces, worker: this.worker, reads: this.reads },
      sessionId,
      lease,
      input,
      (content, expectedHash) =>
        this.write(
          sessionId,
          { path: input.path, content, expectedHash },
          authorization,
        ),
    );
  }

  private mutationDeps() {
    return {
      workspaces: this.workspaces,
      worker: this.worker,
      operations: this.operations,
      locks: this.locks,
      changes: this.changesRequired(),
      reads: this.reads,
    };
  }

  private requiredLease(
    sessionId: string,
    capability: 'files.write' | 'files.delete',
    authorization?: AuthorizedCapabilityContext,
  ) {
    if (!this.recoveryReady) {
      throw Object.assign(new Error('Recovery journal not active'), {
        code: 'CAPABILITY_REQUIRED',
      });
    }
    const lease = this.sessions.activeLease(sessionId);
    if (!lease) {
      throw Object.assign(new Error('Select a workspace'), {
        code: 'SESSION_WORKSPACE_REQUIRED',
      });
    }
    if (lease.capabilities.includes(capability)) return lease;
    const trusted =
      authorization &&
      authorization.sessionId === sessionId &&
      authorization.workspaceId === lease.workspaceId &&
      authorization.actor === lease.actor &&
      authorization.capability === capability;
    if (!trusted) {
      throw Object.assign(new Error(`${capability} required`), {
        code: 'CAPABILITY_REQUIRED',
      });
    }
    return lease;
  }

  private changesRequired() {
    if (!this.changes) {
      throw Object.assign(new Error('Recovery journal not active'), {
        code: 'RECOVERY_REQUIRED',
      });
    }
    return this.changes;
  }

  async runCommand(
    sessionId: string,
    command: {
      executable: string;
      args: string[];
      env?: Record<string, string>;
      timeoutMs?: number;
    },
    executionMode?: 'sandbox' | 'host',
    networkPolicy?: NetworkPolicy,
  ) {
    const lease = this.sessions.activeLease(sessionId);
    if (!lease) {
      throw Object.assign(new Error('Select a workspace'), {
        code: 'SESSION_WORKSPACE_REQUIRED',
      });
    }
    const classification = this.classify([command.executable, ...command.args]);
    const lock = await this.locks.acquire({
      operationId: `op_${randomUUID()}`,
      sessionId,
      workspaceId: lease.workspaceId,
      effect: classification.effect,
      outputKeys: classification.outputKeys,
    });
    const execution = this.executionSettingsResolver?.() ?? {};
    const resolvedMode =
      executionMode ?? (execution.sandboxBackend === 'native' ? 'host' : 'sandbox');
    const sandboxBackend =
      execution.sandboxBackend === 'native' ? 'auto' : (execution.sandboxBackend ?? 'auto');
    const task = this.worker.execute({
      sessionId,
      workspaceId: lease.workspaceId,
      roots: this.workspaces.capabilityRoots(lease.workspaceId),
      operation: {
        kind: 'command.run',
        command: { ...command, env: command.env ?? {}, cwdLogical: '/' },
        sandboxBackend,
        cachePolicy: execution.cachePolicy ?? 'workspace',
        networkPolicy: networkPolicy ?? {
          mode: 'deny-all',
          destinations: [],
          enforcement: 'backend',
        },
      },
      executionMode: resolvedMode,
    });
    let set = this.activeCommands.get(sessionId);
    if (!set) {
      set = new Set();
      this.activeCommands.set(sessionId, set);
    }
    set.add(task);
    try {
      return await task;
    } finally {
      set.delete(task);
      if (!set.size) this.activeCommands.delete(sessionId);
      lock.release();
    }
  }

  async drainSession(sessionId: string, timeoutMs = 60_000) {
    return drainActiveCommands([...(this.activeCommands.get(sessionId) ?? [])], timeoutMs);
  }
}
