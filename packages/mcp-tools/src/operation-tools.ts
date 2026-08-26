import { AevraToolError } from './errors.js';
import type { JsonSchema } from './registry-input-schemas.js';
import type { McpRuntimeContext } from './service-types.js';

export const OPERATION_TOOL_NAMES = new Set(['operation_get', 'operation_list']);

export const operationGetInputSchema: JsonSchema = {
  type: 'object',
  properties: {
    operationId: { type: 'string', description: 'Aevra durable operation ID.' },
  },
  required: ['operationId'],
  additionalProperties: false,
};

export const operationListInputSchema: JsonSchema = {
  type: 'object',
  properties: {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description: 'Maximum number of recent operations to return.',
    },
  },
  additionalProperties: false,
};

export const operationSchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    connectionId: { type: 'string' },
    sessionId: { type: 'string' },
    workspaceId: { type: 'string' },
    kind: { type: 'string' },
    state: {
      type: 'string',
      enum: ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
    },
    result: {},
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: ['id', 'connectionId', 'kind', 'state', 'createdAt', 'updatedAt'],
  additionalProperties: false,
};

export function handleOperationTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  const service = context.deps.resumableOperations;
  if (!service) throw new AevraToolError('CAPABILITY_REQUIRED', 'Operation history is unavailable');
  if (name === 'operation_list') {
    return { result: service.list(sessionId, Number(args?.limit ?? 50)) };
  }
  const operationId = String(args?.operationId ?? '').trim();
  if (!operationId) throw new AevraToolError('INVALID_REQUEST', 'operationId is required');
  const operation = service.get(sessionId, operationId);
  if (!operation) throw new AevraToolError('UNAUTHORIZED', 'Operation not found');
  return operation;
}
