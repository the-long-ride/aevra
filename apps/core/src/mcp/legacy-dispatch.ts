import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleJsonRpc } from '../../../../packages/mcp-tools/src/register.js';
import type { ConnectorProfile } from '../../../../packages/mcp-tools/src/tool-groups.js';
import { responseFailed, type UsageMeter } from '../usage/usage-meter.js';
import type { McpActivityRecorder } from './activity-recorder.js';
import type { McpDiagnostics } from './diagnostics.js';
import { sendJsonBody } from './http-response.js';

export interface LegacyRpcDeps {
  service: any;
  diagnostics: McpDiagnostics;
  activity: McpActivityRecorder;
  usage?: UsageMeter | undefined;
  connectorProfile?: ((actor: string) => ConnectorProfile | undefined) | undefined;
}

/** Dispatches one JSON-RPC request on a legacy (session-header) connection. */
export async function runLegacyRpc(
  deps: LegacyRpcDeps,
  req: IncomingMessage,
  res: ServerResponse,
  actor: string,
  sessionId: string,
  body: any,
) {
  if (body?.method === 'tools/call') {
    deps.diagnostics.recordToolCall(body?.params?.name, sessionId);
  }
  const input = body?.method === 'tools/call' ? body?.params?.arguments : body?.params;
  const activity = deps.activity.begin(actor, sessionId, body?.method, body?.params?.name, input);
  const usage = deps.usage;
  const token = usage?.begin(actor, body?.method, body?.params?.name, input);
  let savedTokens = 0;
  try {
    const result = await handleJsonRpc(deps.service, sessionId, body, undefined, {
      profile: deps.connectorProfile?.(actor),
      onSaved: (_chars, tokens) => {
        savedTokens += tokens;
      },
    });
    deps.activity.finish(activity, result);
    const text = JSON.stringify(result);
    if (usage && token) usage.finish(token, text, { savedTokens, failed: responseFailed(result) });
    await sendJsonBody(res, 200, text, req);
  } catch (error) {
    deps.activity.fail(activity, error);
    if (usage && token) usage.fail(token);
    throw error;
  }
}
