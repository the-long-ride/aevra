import { toolDefinitions } from './registry.js';
import { asToolError } from './errors.js';
import type { McpToolService } from './service.js';
function structuredContent(value: any) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : { result: value };
}
export async function handleJsonRpc(service: McpToolService, sessionId: string, body: any) {
  const id = body?.id ?? null;
  try {
    if (body?.method === 'tools/list')
      return { jsonrpc: '2.0', id, result: { tools: toolDefinitions() } };
    if (body?.method === 'resources/list')
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: (service as any).resourcesList
            ? (service as any).resourcesList(sessionId).resources
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
          prompts: (service as any).promptsList ? (service as any).promptsList().prompts : [],
        },
      };
    if (body?.method === 'prompts/get') {
      try {
        return { jsonrpc: '2.0', id, result: await (service as any).promptGet(sessionId) };
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
        args = body.params?.arguments ?? {},
        data = await service.call(sessionId, name, args);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          structuredContent: structuredContent(data),
        },
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
