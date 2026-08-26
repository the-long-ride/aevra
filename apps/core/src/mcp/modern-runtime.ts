import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VerifiedRemoteIdentity } from '../auth/cloudflare.js';
import type { AevraOAuthService } from '../auth/oauth.js';
import { handleJsonRpc } from '../../../../packages/mcp-tools/src/register.js';
import type { McpActivityRecorder } from './activity-recorder.js';
import type { McpDiagnostics } from './diagnostics.js';
import { remoteIp, sendJson } from './http-response.js';
import {
  MODERN_PROTOCOL_VERSION,
  ModernProtocolError,
  decorateModernResult,
  modernDiscoverResult,
  validateModernRequest,
} from './modern-protocol.js';

interface ModernRuntime {
  sessions: any;
  service: any;
}

export interface McpHookEmitter {
  emit(event: string, context: Record<string, unknown>, payload: unknown): Promise<any> | any;
}

interface ModernRuntimeDependencies {
  runtime: ModernRuntime;
  diagnostics: McpDiagnostics;
  activity: McpActivityRecorder;
  hooks?: McpHookEmitter;
  oauth?: AevraOAuthService;
}

function runtimeHooks(deps: ModernRuntimeDependencies): McpHookEmitter | undefined {
  const service = deps.runtime.service as any;
  return deps.hooks ?? service?.hooks ?? service?.inner?.hooks;
}

async function emitHook(
  hooks: McpHookEmitter | undefined,
  event: string,
  context: Record<string, unknown>,
  payload: unknown,
) {
  if (!hooks) return payload;
  const result = await hooks.emit(event, context, payload);
  if (result?.blocked) {
    const error = new Error(result.reason || `Hook blocked ${event}`);
    (error as any).code = 'HOOK_BLOCKED';
    throw error;
  }
  return result && Object.prototype.hasOwnProperty.call(result, 'payload')
    ? result.payload
    : payload;
}

async function sendHookedResponse(
  res: ServerResponse,
  hooks: McpHookEmitter | undefined,
  context: Record<string, unknown>,
  status: number,
  payload: unknown,
) {
  const effective = await emitHook(hooks, 'before_response', context, payload);
  sendJson(res, status, effective);
  await emitHook(hooks, 'response_finished', context, effective);
}

export async function handleModernRuntimeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  identity: VerifiedRemoteIdentity,
  body: any,
  deps: ModernRuntimeDependencies,
) {
  const hooks = runtimeHooks(deps);
  const context: Record<string, unknown> = {
    actor: identity.actor,
    subject: identity.subject,
    ...(identity.connectionId ? { connectionId: identity.connectionId } : {}),
    protocolVersion: MODERN_PROTOCOL_VERSION,
    method: body?.method,
  };
  await emitHook(hooks, 'request_received', context, body);
  try {
    validateModernRequest(req, body);
  } catch (error) {
    if (error instanceof ModernProtocolError) {
      await sendHookedResponse(res, hooks, context, 400, {
        jsonrpc: '2.0',
        id: body?.id ?? null,
        error: {
          code: error.code,
          message: error.message,
          ...(error.data ? { data: error.data } : {}),
        },
      });
      return;
    }
    throw error;
  }

  if (body?.method === 'server/discover') {
    await sendHookedResponse(res, hooks, context, 200, {
      jsonrpc: '2.0',
      id: body.id ?? null,
      result: modernDiscoverResult(deps.oauth?.issuer),
    });
    return;
  }

  const resolution = deps.runtime.sessions.getOrCreateForIdentity?.(identity, remoteIp(req));
  const session = resolution?.session ?? deps.runtime.sessions.create(identity, remoteIp(req));
  const mode =
    resolution?.mode ??
    (resolution ? (resolution.created === true ? 'created' : 'existing') : 'created');
  context.sessionId = session.id;
  const hookPayload = {
    sessionId: session.id,
    ...(identity.connectionId ? { connectionId: identity.connectionId } : {}),
  };
  if (mode === 'created') {
    await emitHook(hooks, 'session_start', context, hookPayload);
    await emitHook(hooks, 'session_connect', context, hookPayload);
  } else {
    await emitHook(hooks, 'session_reconnect', context, hookPayload);
  }

  deps.runtime.sessions.touch?.(session.id);
  deps.diagnostics.recordIdentity(identity.actor, session.id);
  if (body?.method === 'tools/call')
    deps.diagnostics.recordToolCall(body?.params?.name, session.id);

  const activity = deps.activity.begin(
    identity.actor,
    session.id,
    body?.method,
    body?.params?.name,
    body?.method === 'tools/call' ? body?.params?.arguments : body?.params,
  );
  try {
    const raw = await handleJsonRpc(
      deps.runtime.service,
      session.id,
      body,
      MODERN_PROTOCOL_VERSION,
    );
    const result = decorateModernResult(raw, body?.method, deps.oauth?.issuer);
    deps.activity.finish(activity, result);
    await sendHookedResponse(res, hooks, context, 200, result);
  } catch (error) {
    deps.activity.fail(activity, error);
    await emitHook(hooks, 'response_failed', context, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
