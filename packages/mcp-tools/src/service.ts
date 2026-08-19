import type { ApprovalService } from '../../../apps/core/src/approvals/approval-service.js';
import type { ReadVersionCache } from '../../../apps/core/src/operations/read-version-cache.js';
import type { SessionManager } from '../../../apps/core/src/sessions/session-manager.js';
import type { WorkspaceService } from '../../../apps/core/src/workspaces/workspace-service.js';
import {
  BASIC_TOOL_NAMES,
  handleBasicTool,
  promptGet,
  promptsList,
  resourceRead,
  resourcesList,
} from './basic-tools.js';
import { commandTool, shellTool } from './command-tools.js';
import { AevraToolError } from './errors.js';
import { FILE_TOOL_NAMES, handleFileTool } from './file-tools.js';
import { GIT_TOOL_NAMES, gitTool } from './git-tools.js';
import {
  handleProcessChangeTool,
  processStart,
  PROCESS_CHANGE_TOOL_NAMES,
} from './process-change-tools.js';
import type { McpRuntimeContext, McpToolDependencies, WorkerGateway } from './service-types.js';

export type {
  McpToolDependencies,
  MetricsSink,
  SettingsReader,
  WorkerGateway,
} from './service-types.js';

export class McpToolService {
  private readonly oneTimeCapabilities = new Set<string>();

  constructor(
    private readonly sessions: SessionManager,
    private readonly workspaces: WorkspaceService,
    private readonly worker: WorkerGateway,
    private readonly reads: ReadVersionCache,
    private readonly approvals?: ApprovalService,
    private readonly deps: McpToolDependencies = {},
  ) {
    this.approvals?.setApprovedHandler((ticket) => {
      if (ticket.operation.family === 'workspace:select' && ticket.actor.startsWith('oauth:')) {
        this.sessions.grantConnectionWorkspace(ticket.sessionId, ticket.workspaceId, 'read-only');
      }
    });
  }

  async call(sessionId: string, name: string, args: any = {}) {
    const startedAt = Date.now();
    try {
      return await this.callInner(sessionId, name, args);
    } finally {
      this.deps.metrics?.record(name, Date.now() - startedAt);
    }
  }

  private context(): McpRuntimeContext {
    return {
      sessions: this.sessions,
      workspaces: this.workspaces,
      worker: this.worker,
      reads: this.reads,
      approvals: this.approvals,
      deps: this.deps,
      oneTimeCapabilities: this.oneTimeCapabilities,
      callInner: (sessionId, name, args) => this.callInner(sessionId, name, args),
      processStart: (sessionId, args) => processStart(this.context(), sessionId, args),
    };
  }

  private async callInner(sessionId: string, name: string, args: any = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new AevraToolError('UNAUTHORIZED', 'Unknown Aevra session');
    }
    this.sessions.touch(sessionId);
    const context = this.context();

    if (BASIC_TOOL_NAMES.has(name)) {
      return handleBasicTool(context, sessionId, name, args);
    }
    if (FILE_TOOL_NAMES.has(name)) {
      return handleFileTool(context, sessionId, name, args);
    }
    if (name === 'command_run') {
      return commandTool(context, sessionId, args);
    }
    if (name === 'shell_run') {
      return shellTool(context, sessionId, args);
    }
    if (GIT_TOOL_NAMES.has(name)) {
      return gitTool(context, sessionId, name, args);
    }
    if (PROCESS_CHANGE_TOOL_NAMES.has(name)) {
      return handleProcessChangeTool(context, sessionId, name, args);
    }

    throw new AevraToolError('CAPABILITY_REQUIRED', `Tool ${name} is not enabled`);
  }

  resourcesList(sessionId: string) {
    return resourcesList(this.context(), sessionId);
  }

  async resourceRead(sessionId: string, uri: string) {
    return resourceRead(this.context(), sessionId, uri);
  }

  promptsList() {
    return promptsList();
  }

  async promptGet(sessionId: string) {
    return promptGet(this.context(), sessionId);
  }
}
