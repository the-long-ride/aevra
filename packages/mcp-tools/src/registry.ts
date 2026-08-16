import { emptySchema, inputSchemas, type JsonSchema } from './registry-input-schemas.js';

export const STABLE_TOOL_NAMES = [
  'aevra_status',
  'workspace_list',
  'workspace_select',
  'workspace_current',
  'file_list',
  'file_read',
  'file_search',
  'file_create',
  'file_write',
  'file_patch',
  'file_move',
  'file_delete',
  'command_run',
  'shell_run',
  'process_start',
  'process_list',
  'process_status',
  'process_wait',
  'process_logs',
  'process_stop',
  'process_restart',
  'git_status',
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
const outputSchemas: Partial<Record<AevraToolName, JsonSchema>> = {
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
  skill_write: anyObjectSchema,
  instructions_write: anyObjectSchema,
};

const readOnly = new Set<AevraToolName>([
  'aevra_status',
  'workspace_list',
  'workspace_select',
  'workspace_current',
  'file_list',
  'file_read',
  'file_search',
  'process_list',
  'process_status',
  'process_wait',
  'process_logs',
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
const openWorld = new Set<AevraToolName>(['git_push', 'command_run', 'shell_run', 'process_start']);

const descriptions: Partial<Record<AevraToolName, string>> = {
  aevra_status: 'Show the current Aevra MCP session, active workspace, and granted capabilities.',
  workspace_list: 'List workspaces already registered by the local Aevra administrator.',
  workspace_select:
    'Select an already-registered workspace for this MCP session without modifying workspace files.',
  workspace_current: 'Show the workspace currently selected for this MCP session.',
  file_list: 'List files and directories under a logical path in the active workspace.',
  file_read: 'Read a file from the active workspace, with optional partial-read offsets.',
  file_search: 'Search for text inside files in the active workspace.',
  file_create: 'Create a file in the active workspace.',
  file_write:
    'Replace file content in the active workspace with optional expected-hash protection.',
  file_patch: 'Apply a patch to a file in the active workspace with optional conflict protection.',
  file_move: 'Move or rename a path inside the active workspace.',
  file_delete: 'Delete a file or directory inside the active workspace.',
  command_run: 'Run a bounded command through Aevra execution and approval policy.',
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
  git_status: 'Read Git status for the active workspace.',
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
  return STABLE_TOOL_NAMES.map((name) => ({
    name,
    description:
      descriptions[name] ??
      `Aevra ${name.startsWith('aevra_') ? name.slice('aevra_'.length) : name.replaceAll('_', ' ')}`,
    inputSchema: inputSchemas[name] ?? emptySchema,
    outputSchema: outputSchemas[name] ?? anyObjectSchema,
    annotations: {
      readOnlyHint: readOnly.has(name),
      destructiveHint: destructive.has(name),
      idempotentHint: readOnly.has(name),
      openWorldHint: openWorld.has(name),
    },
  }));
}
