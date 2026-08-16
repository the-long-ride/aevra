import { randomUUID } from 'node:crypto';
import type { WorkerGateway } from '../../../../packages/mcp-tools/src/service.js';
import type { CommandEffect, NetworkPolicy } from '../../../../packages/protocol/src/index.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { WorkspaceService } from '../workspaces/workspace-service.js';
import type { WorkspaceLockCoordinator } from '../policy/workspace-locks.js';

export interface CommandRunInput {
  executable: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

interface CommandClassification {
  effect: CommandEffect;
  outputKeys: string[];
}

type ExecutionSettings = {
  sandboxBackend?: 'auto' | 'docker' | 'podman' | 'native';
  cachePolicy?: 'shared' | 'workspace' | 'disabled';
};

export class CommandExecution {
  private active = new Map<string, Set<Promise<unknown>>>();
  private settingsResolver?: () => ExecutionSettings;

  constructor(
    private sessions: SessionManager,
    private workspaces: WorkspaceService,
    private worker: WorkerGateway,
    private locks: WorkspaceLockCoordinator,
    private classify: (tokens: string[]) => CommandClassification,
  ) {}

  setSettingsResolver(resolver: () => ExecutionSettings) {
    this.settingsResolver = resolver;
  }

  async run(
    sessionId: string,
    command: CommandRunInput,
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
    const execution = this.settingsResolver?.() ?? {};
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
    let active = this.active.get(sessionId);
    if (!active) {
      active = new Set();
      this.active.set(sessionId, active);
    }
    active.add(task);
    try {
      return await task;
    } finally {
      active.delete(task);
      if (!active.size) this.active.delete(sessionId);
      lock.release();
    }
  }

  async drain(sessionId: string, timeoutMs = 60_000) {
    const pending = [...(this.active.get(sessionId) ?? [])];
    if (!pending.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Object.assign(new Error('Workspace switch drain timeout'), {
                  code: 'WORKSPACE_SWITCH_TIMEOUT',
                }),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
