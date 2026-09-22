import type { ApprovalService } from '../../../apps/core/src/approvals/approval-service.js';
import type { ReadVersionCache } from '../../../apps/core/src/operations/read-version-cache.js';
import type { SessionManager } from '../../../apps/core/src/sessions/session-manager.js';
import type { WorkspaceService } from '../../../apps/core/src/workspaces/workspace-service.js';
import type { CommandRequest } from '../../protocol/src/index.js';
import {
  BASIC_TOOL_NAMES,
  handleBasicTool,
  promptGet,
  promptsList,
  resourceRead,
  resourcesList,
} from './basic-tools.js';
import { BROWSER_TOOL_NAMES, handleBrowserTool } from './browser-tools.js';
import { commandTool, shellTool } from './command-tools.js';
import { CONTROL_TOOL_NAMES, handleControlTool } from './control-tools.js';
import { DESKTOP_TOOL_NAMES, handleDesktopTool } from './desktop-tools.js';
import { AevraToolError } from './errors.js';
import { FAST_LANE_TOOL_NAMES, isFastLaneTool } from './fast-lane-schemas.js';
import { handleFastLaneTool } from './fast-lane-tools.js';
import { FILE_TOOL_NAMES, handleFileTool } from './file-tools.js';
import { GIT_TOOL_NAMES, gitTool } from './git-tools.js';
import { HookService } from './hook-service.js';
import { handleOperationTool, OPERATION_TOOL_NAMES } from './operation-tools.js';
import {
  handleProcessChangeTool,
  processStart,
  PROCESS_CHANGE_TOOL_NAMES,
} from './process-change-tools.js';
import { searchTool } from './search-tool.js';
import { evaluateRuntimeCommand } from './command-evaluation.js';
import { resolveWorkspaceLease } from './service-helpers.js';
import type {
  McpProxyOperation,
  McpRuntimeContext,
  McpToolDependencies,
  WorkerGateway,
} from './service-types.js';
import {
  proxyPromptEntries,
  proxyResourceEntries,
  proxyToolDefinitions,
} from './upstream-catalog.js';
import { callUpstreamTool, getUpstreamPrompt, readUpstreamResource } from './upstream-proxy.js';
import { splitProxyName, splitProxyResourceUri } from './upstream-names.js';

const TARGETED_WORKSPACE_TOOLS = new Set([
  ...FILE_TOOL_NAMES,
  ...FAST_LANE_TOOL_NAMES,
  ...GIT_TOOL_NAMES,
  'search',
  'command_run',
  'shell_run',
  'process_start',
  'process_list',
  'change_begin',
  ...BROWSER_TOOL_NAMES,
  ...CONTROL_TOOL_NAMES,
  ...DESKTOP_TOOL_NAMES,
]);

function needsWorkspaceTarget(name: string, args: any) {
  if (name === 'workspace_select') return false;
  if (TARGETED_WORKSPACE_TOOLS.has(name)) return true;
  const explicitTarget = Boolean(
    String(args?.workspace ?? '').trim() || String(args?.workspaceId ?? '').trim(),
  );
  if (explicitTarget) return true;
  if (name === 'skill_read' || name === 'skill_write' || name === 'instructions_write') {
    return args?.source === 'workspace';
  }
  return false;
}

function transformedToolCall(payload: unknown, fallbackName: string, fallbackArgs: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AevraToolError(
      'INVALID_REQUEST',
      'Hook tool transformation must return an object payload',
    );
  }
  const value = payload as Record<string, unknown>;
  const name = String(value.name ?? fallbackName).trim();
  const args = Object.prototype.hasOwnProperty.call(value, 'args') ? value.args : fallbackArgs;
  if (!name)
    throw new AevraToolError('INVALID_REQUEST', 'Hook tool transformation requires a tool name');
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new AevraToolError(
      'INVALID_REQUEST',
      'Hook tool transformation requires object arguments',
    );
  }
  return { name, args };
}

function transformedToolResult(payload: unknown, fallback: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fallback;
  const value = payload as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(value, 'result') ? value.result : fallback;
}

export type {
  McpToolDependencies,
  MetricsSink,
  SettingsReader,
  WorkerGateway,
} from './service-types.js';

export class McpToolService {
  private readonly oneTimeCapabilities = new Set<string>();
  readonly hooks?: HookService;

  constructor(
    private readonly sessions: SessionManager,
    private readonly workspaces: WorkspaceService,
    private readonly worker: WorkerGateway,
    private readonly reads: ReadVersionCache,
    private readonly approvals?: ApprovalService,
    private readonly deps: McpToolDependencies = {},
  ) {
    if (deps.settings) this.hooks = new HookService(deps.settings, worker);
  }

  async call(sessionId: string, name: string, args: any = {}) {
    const startedAt = Date.now();
    const session = this.sessions.get(sessionId);
    const hookContext = {
      sessionId,
      actor: session?.actor,
      subject: session?.subject,
      tool: name,
    };
    try {
      const before = await this.hooks?.emit('before_tool_call', hookContext, { name, args });
      if (before?.blocked) {
        throw new AevraToolError('INVALID_REQUEST', before.reason ?? `Hook blocked ${name}`);
      }
      const effective = before ? transformedToolCall(before.payload, name, args) : { name, args };
      const result = await this.callInner(sessionId, effective.name, effective.args);
      const after = await this.hooks?.emit(
        'after_tool_call',
        { ...hookContext, tool: effective.name },
        { name: effective.name, result },
      );
      return after ? transformedToolResult(after.payload, result) : result;
    } catch (error) {
      await this.hooks?.emit('after_tool_call', hookContext, {
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.deps.metrics?.record(name, Date.now() - startedAt);
    }
  }

  private context(workspaceId?: string): McpRuntimeContext {
    return {
      sessions: this.sessions,
      workspaces: this.workspaces,
      ...(workspaceId ? { workspaceId } : {}),
      worker: this.worker,
      reads: this.reads,
      approvals: this.approvals,
      deps: this.deps,
      oneTimeCapabilities: this.oneTimeCapabilities,
      callInner: (sessionId, name, args) => this.callInner(sessionId, name, args),
      proxyOperation: (sessionId, operation: McpProxyOperation) => {
        if (operation.kind === 'tool')
          return callUpstreamTool(this.context(), sessionId, operation.name, operation.args);
        if (operation.kind === 'resource')
          return readUpstreamResource(this.context(), sessionId, operation.uri);
        return getUpstreamPrompt(this.context(), sessionId, operation.name, operation.args);
      },
      processStart: (sessionId, args) => processStart(this.context(workspaceId), sessionId, args),
    };
  }

  private async callInner(sessionId: string, name: string, args: any = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new AevraToolError('UNAUTHORIZED', 'Unknown Aevra session');
    const baseContext = this.context();
    const workspaceLease = needsWorkspaceTarget(name, args)
      ? resolveWorkspaceLease(baseContext, sessionId, args)
      : null;
    this.sessions.touch(sessionId, workspaceLease?.workspaceId);
    const context = this.context(workspaceLease?.workspaceId);

    if (BASIC_TOOL_NAMES.has(name)) return handleBasicTool(context, sessionId, name, args);
    if (isFastLaneTool(name)) return handleFastLaneTool(context, sessionId, name, args);
    if (FILE_TOOL_NAMES.has(name)) return handleFileTool(context, sessionId, name, args);
    if (name === 'search') return searchTool(context, sessionId, args);
    if (name === 'command_run') return commandTool(context, sessionId, args);
    if (name === 'shell_run') return shellTool(context, sessionId, args);
    if (GIT_TOOL_NAMES.has(name)) return gitTool(context, sessionId, name, args);
    if (OPERATION_TOOL_NAMES.has(name)) return handleOperationTool(context, sessionId, name, args);
    if (PROCESS_CHANGE_TOOL_NAMES.has(name)) {
      return handleProcessChangeTool(context, sessionId, name, args);
    }
    if (BROWSER_TOOL_NAMES.has(name)) return handleBrowserTool(context, sessionId, name, args);
    if (CONTROL_TOOL_NAMES.has(name)) return handleControlTool(context, sessionId, name, args);
    if (DESKTOP_TOOL_NAMES.has(name)) return handleDesktopTool(context, sessionId, name, args);
    return callUpstreamTool(context, sessionId, name, args);
  }

  async evaluateCommand(
    sessionId: string,
    workspaceId: string | undefined,
    rawRequest: CommandRequest,
  ) {
    return evaluateRuntimeCommand(this.context(workspaceId), sessionId, workspaceId, rawRequest);
  }

  async evaluateCommandInput(input: {
    sessionId: string;
    workspaceId?: string;
    request: CommandRequest;
  }) {
    return this.evaluateCommand(input.sessionId, input.workspaceId, input.request);
  }

  async upstreamToolDefinitions() {
    await this.deps.upstreams?.reconcileChanged?.();
    return proxyToolDefinitions(this.deps.upstreams);
  }

  async resourcesList(sessionId: string) {
    await this.deps.upstreams?.reconcileChanged?.();
    const local = resourcesList(this.context(), sessionId);
    return { resources: [...local.resources, ...proxyResourceEntries(this.deps.upstreams)] };
  }

  async resourceRead(sessionId: string, uri: string) {
    if (splitProxyResourceUri(uri)) return readUpstreamResource(this.context(), sessionId, uri);
    return resourceRead(this.context(), sessionId, uri);
  }

  async promptsList() {
    await this.deps.upstreams?.reconcileChanged?.();
    return { prompts: [...promptsList().prompts, ...proxyPromptEntries(this.deps.upstreams)] };
  }

  async promptGet(sessionId: string, name = '', args: unknown = {}) {
    if (splitProxyName(name)) return getUpstreamPrompt(this.context(), sessionId, name, args);
    const session = this.sessions.get(sessionId);
    const context = { sessionId, actor: session?.actor, subject: session?.subject };
    const prompt = await promptGet(this.context(), sessionId);
    const transformed = await this.hooks?.emit('prompt_received', context, prompt);
    if (transformed?.blocked) {
      throw new AevraToolError(
        'INVALID_REQUEST',
        transformed.reason ?? 'Hook blocked prompt request',
      );
    }
    return transformed ? transformed.payload : prompt;
  }
}
