import { advertisedToolDefinitions } from './registry-advertised.js';
import { asToolError } from './errors.js';
import { shapeToolResult } from './result-shaper/shape.js';
import type { McpToolService } from './service.js';
import {
  assertToolGroupEnabled,
  isGroupEnabled,
  type ConnectorProfile,
  type ResultFormat,
} from './tool-groups.js';

function structuredContent(value: any, protocolVersion?: string) {
  if (protocolVersion === '2026-07-28') return value;
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : { result: value };
}

function toolEnvelope(
  data: unknown,
  protocolVersion: string | undefined,
  format: ResultFormat | undefined,
) {
  const structured = format === 'text' ? undefined : structuredContent(data, protocolVersion);
  const text =
    format === 'structured' && structured !== undefined
      ? 'See structuredContent.'
      : JSON.stringify(data);
  return {
    content: [{ type: 'text', text }],
    ...(structured !== undefined ? { structuredContent: structured } : {}),
  };
}

interface RpcOptions {
  profile?: ConnectorProfile | undefined;
  onSaved?: ((savedChars: number, savedTokens: number) => void) | undefined;
}

export async function handleJsonRpc(
  service: McpToolService,
  sessionId: string,
  body: any,
  protocolVersion?: string,
  options: RpcOptions = {},
) {
  const id = body?.id ?? null;
  try {
    if (body?.method === 'tools/list') {
      const groups = options.profile?.toolGroups;
      const upstream = isGroupEnabled('upstream', groups)
        ? ((await (service as any).upstreamToolDefinitions?.()) ?? [])
        : [];
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: [...advertisedToolDefinitions(groups), ...upstream] },
      };
    }
    if (body?.method === 'resources/list')
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: (service as any).resourcesList
            ? (await (service as any).resourcesList(sessionId)).resources
            : [],
        },
      };
    if (body?.method === 'resources/read') {
      try {
        return {
          jsonrpc: '2.0',
          id,
          result: await (service as any).resourceRead(sessionId, String(body.params?.uri ?? '')),
        };
      } catch (e) {
        const x = asToolError(e);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: { code: x.code, message: x.message, details: x.details },
                }),
              },
            ],
          },
        };
      }
    }
    if (body?.method === 'prompts/list')
      return {
        jsonrpc: '2.0',
        id,
        result: {
          prompts: (service as any).promptsList
            ? (await (service as any).promptsList()).prompts
            : [],
        },
      };
    if (body?.method === 'prompts/get') {
      try {
        return {
          jsonrpc: '2.0',
          id,
          result: await (service as any).promptGet(
            sessionId,
            String(body.params?.name ?? ''),
            body.params?.arguments ?? {},
          ),
        };
      } catch (e) {
        const x = asToolError(e);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: { code: x.code, message: x.message, details: x.details },
                }),
              },
            ],
          },
        };
      }
    }
    if (body?.method === 'tools/call') {
      const name = String(body.params?.name ?? ''),
        args = body.params?.arguments ?? {};
      assertToolGroupEnabled(name, options.profile?.toolGroups);
      const shaped = shapeToolResult(
        name,
        args,
        await service.call(sessionId, name, args, options.profile),
      );
      if (shaped.savedChars || shaped.savedTokens)
        options.onSaved?.(shaped.savedChars, shaped.savedTokens);
      return {
        jsonrpc: '2.0',
        id,
        result: toolEnvelope(shaped.data, protocolVersion, options.profile?.resultFormat),
      };
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  } catch (e) {
    const x = asToolError(e);
    return {
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: { code: x.code, message: x.message, details: x.details },
            }),
          },
        ],
      },
    };
  }
}
