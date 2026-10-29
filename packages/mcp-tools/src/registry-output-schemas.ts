import { operationSchema } from './operation-tools.js';
import type { JsonSchema } from './registry-input-schemas.js';
import { transferResultOutputSchema } from './registry-transfer-schemas.js';
import type { AevraToolName } from './registry.js';

export const anyObjectSchema: JsonSchema = { type: 'object' };
const processState = {
  type: 'string',
  enum: ['running', 'completed', 'failed', 'stopped', 'unknown'],
};
const processStatusProperties = {
  processId: { type: 'string' },
  name: { type: 'string' },
  pid: { type: 'integer' },
  startedAt: { type: 'string' },
  lifecycle: { type: 'string', enum: ['stop-with-aevra', 'keep-running'] },
  state: processState,
  exitCode: { type: ['integer', 'null'] },
  signal: { type: ['string', 'null'] },
  finishedAt: { type: ['string', 'null'] },
  durationMs: { type: ['number', 'null'], minimum: 0 },
  marker: { type: 'string' },
  logPath: { type: 'string' },
  resultPath: { type: 'string' },
};
const processStatusSchema: JsonSchema = {
  type: 'object',
  properties: processStatusProperties,
  required: [
    'processId',
    'pid',
    'startedAt',
    'lifecycle',
    'state',
    'exitCode',
    'signal',
    'finishedAt',
    'durationMs',
  ],
  additionalProperties: false,
};
const fileListEntrySchema: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', enum: ['directory', 'file', 'link', 'other'] },
  },
  required: ['name', 'type'],
  additionalProperties: false,
};
const searchHitSchema: JsonSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    line: { type: 'integer' },
    text: { type: 'string' },
  },
  required: ['path'],
  additionalProperties: false,
};
export const outputSchemas: Partial<Record<AevraToolName, JsonSchema>> = {
  file_list: {
    type: 'object',
    properties: { entries: { type: 'array', items: fileListEntrySchema } },
    required: ['entries'],
    additionalProperties: false,
  },
  file_search: {
    type: 'object',
    properties: {
      hits: { type: 'array', items: searchHitSchema },
      untrusted: { type: 'boolean' },
      notice: { type: 'string' },
    },
    required: ['hits'],
    additionalProperties: false,
  },
  workspace_list: {
    type: 'object',
    properties: { workspaces: { type: 'array', items: anyObjectSchema } },
    required: ['workspaces'],
    additionalProperties: false,
  },
  process_start: anyObjectSchema,
  process_list: {
    type: 'object',
    properties: { result: { type: 'array', items: processStatusSchema } },
    required: ['result'],
    additionalProperties: false,
  },
  process_status: processStatusSchema,
  process_wait: processStatusSchema,
  process_logs: {
    type: 'object',
    properties: {
      processId: { type: 'string' },
      cursor: { type: 'integer' },
      lines: { type: 'array', items: { type: 'string' } },
      state: processState,
      exitCode: { type: ['integer', 'null'] },
      signal: { type: ['string', 'null'] },
      finishedAt: { type: ['string', 'null'] },
      eof: { type: 'boolean' },
    },
    required: ['processId', 'cursor', 'lines', 'state', 'exitCode', 'signal', 'finishedAt', 'eof'],
    additionalProperties: false,
  },
  process_stop: {
    type: 'object',
    properties: { processId: { type: 'string' }, stopped: { type: 'boolean' } },
    required: ['processId', 'stopped'],
    additionalProperties: false,
  },
  process_restart: processStatusSchema,
  operation_get: operationSchema,
  operation_list: {
    type: 'object',
    properties: { result: { type: 'array', items: operationSchema } },
    required: ['result'],
    additionalProperties: false,
  },
  skill_write: anyObjectSchema,
  instructions_write: anyObjectSchema,
  files_download: transferResultOutputSchema,
};
