import type { WorkerOperation } from '../../protocol/src/worker.js';
import type { SettingsReader, WorkerGateway } from './service-types.js';

export const HOOK_EVENTS = [
  'session_start',
  'session_connect',
  'session_reconnect',
  'request_received',
  'prompt_received',
  'before_tool_call',
  'after_tool_call',
  'before_response',
  'after_response',
  'response_finished',
  'response_failed',
] as const;

export const HOOK_PERMISSIONS = [
  'observe',
  'block',
  'modifyPrompt',
  'modifyToolInput',
  'modifyToolOutput',
  'modifyResponse',
] as const;

export type HookPermission = (typeof HOOK_PERMISSIONS)[number];

export interface HookConfig {
  id: string;
  name: string;
  event: string;
  enabled: boolean;
  kind: string;
  execution: 'run' | 'launch';
  executable: string;
  args: string[];
  env?: Record<string, string>;
  permissions?: HookPermission[];
  timeoutMs: number;
  failurePolicy: 'continue' | 'block';
}

const BLOCKABLE_EVENTS = new Set([
  'session_start',
  'session_connect',
  'session_reconnect',
  'request_received',
  'prompt_received',
  'before_tool_call',
  'before_response',
]);

const TRANSFORM_PERMISSION: Record<string, HookPermission | undefined> = {
  prompt_received: 'modifyPrompt',
  before_tool_call: 'modifyToolInput',
  after_tool_call: 'modifyToolOutput',
  before_response: 'modifyResponse',
};

function matchesEvent(configured: string, emitted: string) {
  if (configured === emitted) return true;
  return configured === 'after_response' && emitted === 'response_finished';
}

function permissionsFor(hook: HookConfig) {
  if (Array.isArray(hook.permissions) && hook.permissions.length) {
    return new Set<HookPermission>(hook.permissions);
  }
  // Hooks created before permission-scoped middleware are grandfathered into
  // their previous observe/block behavior, but never receive mutation rights.
  return new Set<HookPermission>(['observe', 'block']);
}

function controlFromStdout(stdout: unknown) {
  const lines = String(stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  try {
    const value = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export class HookService {
  constructor(
    private readonly settings: SettingsReader,
    private readonly worker: WorkerGateway,
  ) {}

  async emit(event: string, context: Record<string, unknown>, payload: unknown) {
    const hooks = this.settings
      .get<HookConfig[]>('hooks.config', [])
      .filter((hook) => hook?.enabled !== false && matchesEvent(String(hook?.event), event));
    const invocations: Array<Record<string, unknown>> = [];
    const blockable = BLOCKABLE_EVENTS.has(event);
    const transformPermission = TRANSFORM_PERMISSION[event];
    let effectivePayload = payload;

    for (const hook of hooks) {
      const permissions = permissionsFor(hook);
      const operation: WorkerOperation = {
        kind: 'hook.run',
        event,
        hookKind: String(hook.kind || 'command'),
        executable: String(hook.executable || ''),
        args: Array.isArray(hook.args) ? hook.args.map(String) : [],
        env: hook.env && typeof hook.env === 'object' ? hook.env : {},
        timeoutMs: Math.max(100, Math.min(60_000, Number(hook.timeoutMs) || 5_000)),
        execution: hook.execution === 'launch' ? 'launch' : 'run',
        context,
        payload: effectivePayload,
      };
      try {
        const result = await this.worker.execute({
          sessionId: String(context.sessionId ?? `hook:${event}`),
          workspaceId: String(context.workspaceId ?? 'hook-system'),
          roots: [],
          operation,
          executionMode: 'host',
        });
        if (!result.ok) {
          invocations.push({ id: hook.id, ok: false, error: result.error.message });
          if (blockable && permissions.has('block') && hook.failurePolicy === 'block') {
            return { payload: effectivePayload, blocked: true, reason: result.error.message, invocations };
          }
          continue;
        }

        const value = result.value as Record<string, unknown> | undefined;
        const failed =
          Boolean(value?.timedOut) ||
          (typeof value?.exitCode === 'number' && value.exitCode !== 0);
        const control = controlFromStdout(value?.stdout);
        const invocation: Record<string, unknown> = {
          id: hook.id,
          ok: !failed,
          ...(typeof value?.exitCode === 'number' ? { exitCode: value.exitCode } : {}),
          ...(value?.launched ? { launched: true } : {}),
        };

        if (
          !failed &&
          control?.action === 'modify' &&
          transformPermission &&
          permissions.has(transformPermission) &&
          Object.prototype.hasOwnProperty.call(control, 'payload')
        ) {
          effectivePayload = control.payload;
          invocation.action = 'modify';
        } else if (!failed && control?.action === 'block') {
          invocation.action = permissions.has('block') ? 'block' : 'ignored-block';
        }
        invocations.push(invocation);

        if (!failed && blockable && permissions.has('block') && control?.action === 'block') {
          return {
            payload: effectivePayload,
            blocked: true,
            reason: String(control.message ?? `Hook ${hook.name || hook.id} blocked ${event}`),
            invocations,
          };
        }
        if (blockable && permissions.has('block') && failed && hook.failurePolicy === 'block') {
          return {
            payload: effectivePayload,
            blocked: true,
            reason: `Hook ${hook.name || hook.id} failed during ${event}`,
            invocations,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        invocations.push({ id: hook.id, ok: false, error: message });
        if (blockable && permissions.has('block') && hook.failurePolicy === 'block') {
          return { payload: effectivePayload, blocked: true, reason: message, invocations };
        }
      }
    }
    return { payload: effectivePayload, blocked: false, invocations };
  }
}
