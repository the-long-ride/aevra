import {
  operationGetInputSchema,
  operationListInputSchema,
  operationSchema,
} from './operation-tools.js';
import { fastLaneInputSchemas } from './fast-lane-schemas.js';
import { emptySchema, inputSchemas, type JsonSchema } from './registry-input-schemas.js';
import { toolDescriptions } from './registry-descriptions.js';
import { searchInputSchema } from './search-tool.js';

export const STABLE_TOOL_NAMES = [
  'aevra_status',
  'workspace_list',
  'workspace_select',
  'workspace_current',
  'file_list',
  'file_read',
  'file_read_many',
  'file_search',
  'search',
  'file_create',
  'file_write',
  'file_patch',
  'file_write_many',
  'file_move',
  'file_delete',
  'command_run',
  'command_run_many',
  'shell_run',
  'process_start',
  'process_list',
  'process_status',
  'process_wait',
  'process_logs',
  'process_stop',
  'process_restart',
  'operation_get',
  'operation_list',
  'git_status',
  'git_add',
  'git_diff',
  'git_log',
  'git_branch',
  'git_commit',
  'git_push',
  'change_begin',
  'change_status',
  'change_commit',
  'change_rollback',
  'approval_status',
  'approval_wait',
  'approval_cancel',
  'skills_list',
  'skill_read',
  'skill_write',
  'instructions_read',
  'instructions_write',
  'browser_connect',
  'browser_status',
  'browser_disconnect',
  'browser_tabs',
  'browser_navigate',
  'browser_snapshot',
  'browser_read',
  'browser_act_many',
  'browser_logs',
  'desktop_status',
  'desktop_connect',
  'desktop_disconnect',
  'desktop_apps',
  'desktop_windows',
  'desktop_describe',
  'desktop_capture',
  'desktop_click',
  'desktop_type',
  'desktop_key',
  'desktop_scroll',
  'desktop_invoke',
  'desktop_set_value',
  'desktop_select',
  'desktop_toggle',
  'desktop_release_window',
] as const;
export type AevraToolName = (typeof STABLE_TOOL_NAMES)[number];

const MODEL_HIDDEN_TOOL_NAMES = new Set<AevraToolName>([
  'file_read',
  'file_create',
  'file_write',
  'file_patch',
  'command_run',
]);

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};
type ToolDescriptor = {
  name: AevraToolName;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations: ToolAnnotations;
};

const anyObjectSchema: JsonSchema = { type: 'object' };
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
const outputSchemas: Partial<Record<AevraToolName, JsonSchema>> = {
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
};

const operationInputs: Partial<Record<AevraToolName, JsonSchema>> = {
  operation_get: operationGetInputSchema,
  operation_list: operationListInputSchema,
};

const readOnly = new Set<AevraToolName>([
  'aevra_status',
  'workspace_list',
  'workspace_select',
  'workspace_current',
  'file_list',
  'file_read',
  'file_read_many',
  'file_search',
  'search',
  'process_list',
  'process_status',
  'process_wait',
  'process_logs',
  'operation_get',
  'operation_list',
  'git_status',
  'git_diff',
  'git_log',
  'change_status',
  'approval_status',
  'skills_list',
  'skill_read',
  'instructions_read',
  'desktop_status',
  'desktop_apps',
  'desktop_windows',
  'desktop_describe',
  'desktop_capture',
]);
// `destructive` here means "irreversible or unbounded-consequence", not
// merely "mutates something" -- file_delete, git_push, change_rollback,
// skill_write, and instructions_write all destroy or publish something this
// codebase cannot undo. The four desktop input tools belong beside them: a
// click, keystroke, or scroll drives an arbitrary GUI Aevra has no model of,
// so it can trigger anything that GUI exposes -- submitting a form, closing
// a document without saving, confirming a purchase, deleting a file through
// a file manager -- with no transaction to roll back and no diff to review
// first, unlike a file write or a sandboxed command.
const destructive = new Set<AevraToolName>([
  'file_delete',
  'git_push',
  'change_rollback',
  'skill_write',
  'instructions_write',
  'desktop_click',
  'desktop_type',
  'desktop_key',
  'desktop_scroll',
  'desktop_invoke',
  'desktop_set_value',
  'desktop_select',
  'desktop_toggle',
]);
// `openWorld` marks a tool whose effect reaches outside the workspace
// sandbox this codebase can see and reason about. The four desktop input
// tools qualify for the same reason command_run/shell_run/process_start do:
// they drive the live OS desktop, not workspace-scoped state, so their
// effect is on whatever application happens to be focused (or, for a
// coordinate click, whatever the point resolves to) -- entirely outside
// this codebase's own boundary.
const openWorld = new Set<AevraToolName>([
  'git_push',
  'command_run',
  'command_run_many',
  'shell_run',
  'process_start',
  'desktop_click',
  'desktop_type',
  'desktop_key',
  'desktop_scroll',
  'desktop_invoke',
  'desktop_set_value',
  'desktop_select',
  'desktop_toggle',
]);

export function toolDefinitions(): ToolDescriptor[] {
  return STABLE_TOOL_NAMES.filter((name) => !MODEL_HIDDEN_TOOL_NAMES.has(name)).map((name) => ({
    name,
    description:
      toolDescriptions[name] ??
      `Aevra ${name.startsWith('aevra_') ? name.slice('aevra_'.length) : name.replaceAll('_', ' ')}`,
    inputSchema:
      name in fastLaneInputSchemas
        ? fastLaneInputSchemas[name as keyof typeof fastLaneInputSchemas]
        : name === 'search'
          ? searchInputSchema
          : (operationInputs[name] ?? inputSchemas[name] ?? emptySchema),
    outputSchema: outputSchemas[name] ?? anyObjectSchema,
    annotations: {
      readOnlyHint: readOnly.has(name),
      destructiveHint: destructive.has(name),
      idempotentHint: readOnly.has(name),
      openWorldHint: openWorld.has(name),
    },
  }));
}
