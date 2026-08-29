import {
  operationGetInputSchema,
  operationListInputSchema,
  operationSchema,
} from './operation-tools.js';
import { fastLaneInputSchemas } from './fast-lane-schemas.js';
import { emptySchema, inputSchemas, type JsonSchema } from './registry-input-schemas.js';
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
]);
const destructive = new Set<AevraToolName>([
  'file_delete',
  'git_push',
  'change_rollback',
  'skill_write',
  'instructions_write',
]);
const openWorld = new Set<AevraToolName>([
  'git_push',
  'command_run',
  'command_run_many',
  'shell_run',
  'process_start',
]);

const descriptions: Partial<Record<AevraToolName, string>> = {
  aevra_status: 'Show the current Aevra MCP session, active workspace, and granted capabilities.',
  workspace_list: 'List workspaces already registered by the local Aevra administrator.',
  workspace_select:
    'Select an already-registered workspace for this MCP session without modifying workspace files.',
  workspace_current: 'Show the workspace currently selected for this MCP session.',
  file_list: 'List files and directories under a logical path in the active workspace.',
  file_read: 'Read a file from the active workspace, with optional partial-read offsets.',
  file_read_many:
    'Read one or more files from a workspace, up to 32 per call, with bounded concurrency and per-file results.',
  file_search: 'Search for one text value inside files in the active workspace.',
  search:
    'Search the codebase for multiple text, regex, or file-name values in parallel using native search tooling.',
  file_create: 'Create a file in the active workspace.',
  file_write:
    'Replace file content in the active workspace with optional expected-hash protection.',
  file_patch: 'Apply a patch to a file in the active workspace with optional conflict protection.',
  file_write_many:
    'Create, replace, or patch one or more files in a workspace, up to 32 changes per call, while preserving approvals, recovery, conflict checks, and workspace mutation locks.',
  file_move: 'Move or rename a path inside the active workspace.',
  file_delete: 'Delete a file or directory inside the active workspace.',
  command_run: 'Run a bounded command through Aevra execution and approval policy.',
  command_run_many:
    'Run one or more bounded commands through Aevra execution and approval policy, up to 16 per call, with bounded concurrency and conflict serialization.',
  shell_run:
    'Run a PowerShell, bash, or sh script in the active workspace through Aevra command policy, sandbox, and local approval controls.',
  process_start:
    'Start a managed process and return immediately with a durable process ID for later status, wait, and log calls.',
  process_list: 'List managed processes owned by the active workspace with terminal state.',
  process_status: 'Read durable state and exit information for one managed process.',
  process_wait:
    'Wait for one managed process for a bounded interval, returning terminal state immediately when it finishes.',
  process_logs:
    'Read logs and terminal state from a managed process owned by the active workspace.',
  process_stop: 'Stop one managed process owned by the active workspace.',
  process_restart: 'Restart one managed process owned by the active workspace.',
  operation_get:
    'Inspect one durable Aevra operation owned by the current OAuth connection after reconnect.',
  operation_list: 'List recent durable Aevra operations owned by the current OAuth connection.',
  git_status: 'Read Git status for the active workspace.',
  git_add: 'Stage files in the active workspace index (git add). Low-risk, no approval required.',
  git_diff: 'Read a Git diff for the active workspace.',
  git_log: 'Read Git history for the active workspace.',
  git_branch: 'Read or change Git branch state according to Aevra policy.',
  git_commit: 'Create a Git commit in the active workspace.',
  git_push: 'Push Git refs from the active workspace.',
  change_begin: 'Begin a named recovery change set.',
  change_status: 'Inspect one Aevra recovery change set.',
  change_commit: 'Commit one Aevra recovery change set.',
  change_rollback: 'Roll back one Aevra recovery change set.',
  approval_status: 'Inspect one pending or completed local approval request.',
  approval_wait: 'Resume one approved Aevra operation or inspect its current state.',
  approval_cancel: 'Cancel one pending Aevra approval request.',
  skills_list: 'List Aevra skills available from the user and active workspace libraries.',
  skill_read: 'Read one Aevra skill or one file within a skill package.',
  skill_write: 'Write one bounded UTF-8 file inside an existing Aevra skill package.',
  instructions_read: 'Read merged Aevra/AGENTS.md instructions for the active workspace.',
  instructions_write: 'Write the user or active-workspace Aevra AGENTS.md instruction file.',
};

export function toolDefinitions(): ToolDescriptor[] {
  return STABLE_TOOL_NAMES.filter((name) => !MODEL_HIDDEN_TOOL_NAMES.has(name)).map((name) => ({
    name,
    description:
      descriptions[name] ??
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
