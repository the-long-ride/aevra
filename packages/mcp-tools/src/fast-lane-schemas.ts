import type { JsonSchema } from './registry-input-schemas.js';

export type FastLaneToolName = 'file_read_many' | 'file_write_many' | 'command_run_many';

export const FAST_LANE_TOOL_NAMES = new Set<FastLaneToolName>([
  'file_read_many',
  'file_write_many',
  'command_run_many',
]);

export function isFastLaneTool(name: string): name is FastLaneToolName {
  return FAST_LANE_TOOL_NAMES.has(name as FastLaneToolName);
}

const workspaceTargetProperties = {
  workspace: { type: 'string', description: 'Workspace name for this batch.' },
  workspaceId: { type: 'string', description: 'Workspace ID for this batch.' },
};

const commandProperties = {
  executable: { type: 'string', description: 'Executable to run.' },
  args: { type: 'array', items: { type: 'string' }, description: 'Command arguments.' },
  env: {
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Environment variables injected only into the child process.',
  },
  timeoutMs: {
    type: 'integer',
    minimum: 1,
    maximum: 86_400_000,
    description: 'Execution timeout in milliseconds, up to 24 hours.',
  },
};

const commandItemSchema = {
  type: 'object',
  properties: {
    ...commandProperties,
    command: {
      type: 'object',
      properties: commandProperties,
      required: ['executable'],
      additionalProperties: false,
      description: 'Nested command form accepted for compatibility.',
    },
    executionMode: {
      type: 'string',
      enum: ['sandbox', 'host'],
      description: 'Execution mode. Defaults according to Aevra execution settings.',
    },
    networkDestinations: {
      type: 'array',
      items: { type: 'string' },
      description: 'Network destinations requested by the command.',
    },
  },
  anyOf: [{ required: ['executable'] }, { required: ['command'] }],
  additionalProperties: false,
};

const writePathProperty = { type: 'string', description: 'Logical workspace file path.' };
const writeContentProperty = { type: 'string', description: 'File content.' };
const writeExpectedHashProperty = {
  type: 'string',
  description: 'Optional hash from a previous read for conflict detection.',
};
const writeItemSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        operation: { const: 'create' },
        path: writePathProperty,
        content: writeContentProperty,
        encoding: { type: 'string', enum: ['utf8', 'base64'] },
      },
      required: ['operation', 'path', 'content'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        operation: { const: 'replace' },
        path: writePathProperty,
        content: writeContentProperty,
        expectedHash: writeExpectedHashProperty,
      },
      required: ['operation', 'path', 'content'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        operation: { const: 'patch' },
        path: writePathProperty,
        patch: { type: 'string', description: 'Patch text to apply.' },
        expectedHash: writeExpectedHashProperty,
      },
      required: ['operation', 'path', 'patch'],
      additionalProperties: false,
    },
  ],
};

export const fastLaneInputSchemas: Record<FastLaneToolName, JsonSchema> = {
  file_read_many: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      reads: {
        type: 'array',
        minItems: 1,
        maxItems: 32,
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Logical workspace file path to read.' },
            offset: {
              type: 'integer',
              minimum: 0,
              description: 'Optional character offset for a partial read.',
            },
            length: {
              type: 'integer',
              minimum: 0,
              description: 'Optional maximum number of characters to return.',
            },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
      concurrency: {
        type: 'integer',
        minimum: 1,
        maximum: 8,
        description: 'Maximum concurrent reads. Defaults to 8.',
      },
    },
    required: ['reads'],
    additionalProperties: false,
  },
  file_write_many: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      writes: {
        type: 'array',
        minItems: 1,
        maxItems: 32,
        items: writeItemSchema,
      },
      concurrency: {
        type: 'integer',
        minimum: 1,
        maximum: 8,
        description:
          'Maximum child mutations to orchestrate concurrently. Safety locks still serialize conflicting writes. Defaults to 8.',
      },
      failFast: {
        type: 'boolean',
        description: 'Stop scheduling new writes after the first failed child.',
      },
    },
    required: ['writes'],
    additionalProperties: false,
  },
  command_run_many: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      commands: {
        type: 'array',
        minItems: 1,
        maxItems: 16,
        items: commandItemSchema,
      },
      strategy: {
        type: 'string',
        enum: ['auto', 'parallel', 'sequential'],
        description:
          'auto and parallel schedule work concurrently while Aevra safety locks serialize conflicts; sequential forces one-at-a-time execution.',
      },
      concurrency: {
        type: 'integer',
        minimum: 1,
        maximum: 4,
        description: 'Maximum concurrent command calls. Defaults to 4.',
      },
    },
    required: ['commands'],
    additionalProperties: false,
  },
};
