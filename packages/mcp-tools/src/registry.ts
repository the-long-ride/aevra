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

type JsonSchema = Record<string, unknown>;
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

const emptySchema: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
const anyObjectSchema: JsonSchema = { type: 'object' };
const stringProp = (description: string) => ({ type: 'string', description });
const nonNegativeInteger = (description: string) => ({ type: 'integer', minimum: 0, description });
const stringArray = (description: string) => ({
  type: 'array',
  items: { type: 'string' },
  description,
});
const stringMap = (description: string) => ({
  type: 'object',
  additionalProperties: { type: 'string' },
  description,
});
const skillSource = { type: 'string', enum: ['user', 'workspace'], description: 'Skill source.' };
const executionMode = {
  type: 'string',
  enum: ['sandbox', 'host'],
  description: 'Execution mode. Defaults according to Aevra execution settings.',
};
const commandProperties = {
  executable: stringProp('Executable to run in the active workspace.'),
  args: stringArray('Arguments passed directly to the executable.'),
  env: stringMap('Environment variables injected only into the child process.'),
  timeoutMs: {
    type: 'integer',
    minimum: 1,
    maximum: 86_400_000,
    description: 'Execution timeout in milliseconds, up to 24 hours.',
  },
};

const processState = {
  type: 'string',
  enum: ['running', 'completed', 'failed', 'stopped', 'unknown'],
};
const processStatusProperties = {
  processId: { type: 'string' },
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
const processIdSchema: JsonSchema = {
  type: 'object',
  properties: { processId: stringProp('Managed process ID.') },
  required: ['processId'],
  additionalProperties: false,
};
const changeSetIdSchema: JsonSchema = {
  type: 'object',
  properties: { changeSetId: stringProp('Change-set ID.') },
  required: ['changeSetId'],
  additionalProperties: false,
};
const approvalIdSchema: JsonSchema = {
  type: 'object',
  properties: { requestId: stringProp('Approval request ID.') },
  required: ['requestId'],
  additionalProperties: false,
};

const schemas: Partial<Record<AevraToolName, JsonSchema>> = {
  aevra_status: emptySchema,
  workspace_list: emptySchema,
  workspace_select: {
    type: 'object',
    properties: {
      workspace: stringProp('Workspace name or ID to select for this MCP session.'),
      drainTimeoutMs: nonNegativeInteger(
        'Graceful drain timeout before switching workspace, in milliseconds.',
      ),
    },
    required: ['workspace'],
    additionalProperties: false,
  },
  workspace_current: emptySchema,
  file_list: {
    type: 'object',
    properties: { path: stringProp('Logical workspace path to list. Defaults to /.') },
    additionalProperties: false,
  },
  file_read: {
    type: 'object',
    properties: {
      path: stringProp('Logical workspace file path to read.'),
      offset: nonNegativeInteger('Optional character offset for a partial read.'),
      length: nonNegativeInteger('Optional maximum number of characters to return.'),
    },
    required: ['path'],
    additionalProperties: false,
  },
  file_search: {
    type: 'object',
    properties: {
      path: stringProp('Logical workspace path to search. Defaults to /.'),
      query: stringProp('Text to search for inside the active workspace.'),
    },
    required: ['query'],
    additionalProperties: false,
  },
  file_create: {
    type: 'object',
    properties: {
      path: stringProp('Logical workspace path to create.'),
      content: stringProp('File content.'),
      encoding: { type: 'string', enum: ['utf8', 'base64'] },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  file_write: {
    type: 'object',
    properties: {
      path: stringProp('Logical workspace file path to replace.'),
      content: stringProp('UTF-8 file content.'),
      expectedHash: stringProp('Optional hash from a previous read for conflict detection.'),
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  file_patch: {
    type: 'object',
    properties: {
      path: stringProp('Logical workspace file path to patch.'),
      patch: stringProp('Patch text to apply.'),
      expectedHash: stringProp('Optional hash from a previous read for conflict detection.'),
    },
    required: ['path', 'patch'],
    additionalProperties: false,
  },
  file_move: {
    type: 'object',
    properties: {
      from: stringProp('Existing logical workspace path.'),
      to: stringProp('Destination logical workspace path.'),
    },
    required: ['from', 'to'],
    additionalProperties: false,
  },
  file_delete: {
    type: 'object',
    properties: {
      path: stringProp('Logical workspace path to delete.'),
      recursive: { type: 'boolean', description: 'Allow recursive directory deletion.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  command_run: {
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
      executionMode,
      networkDestinations: stringArray('Network destinations requested by the command.'),
    },
    anyOf: [{ required: ['executable'] }, { required: ['command'] }],
    additionalProperties: false,
  },
  shell_run: {
    type: 'object',
    properties: {
      script: stringProp('Shell script to execute inside the active workspace.'),
      shell: {
        type: 'string',
        enum: ['auto', 'powershell', 'bash', 'sh'],
        description:
          'Shell interpreter. auto uses bash in strict sandbox, PowerShell on Windows host, and bash on Unix-like host.',
      },
      executionMode,
      timeoutMs: commandProperties.timeoutMs,
      env: commandProperties.env,
      networkDestinations: stringArray(
        'Optional network destinations subject to Aevra network capability and approval policy.',
      ),
    },
    required: ['script'],
    additionalProperties: false,
  },
  process_start: {
    type: 'object',
    properties: {
      ...commandProperties,
      lifecycle: {
        type: 'string',
        enum: ['stop-with-aevra', 'keep-running'],
        description: 'Whether Aevra stops the process when the gateway stops.',
      },
    },
    required: ['executable'],
    additionalProperties: false,
  },
  process_list: emptySchema,
  process_status: processIdSchema,
  process_wait: {
    type: 'object',
    properties: {
      processId: stringProp('Managed process ID.'),
      timeoutMs: {
        type: 'integer',
        minimum: 0,
        maximum: 30_000,
        description: 'Maximum bounded wait before returning current status. Defaults to 15000 ms.',
      },
    },
    required: ['processId'],
    additionalProperties: false,
  },
  process_logs: {
    type: 'object',
    properties: {
      processId: stringProp('Managed process ID.'),
      cursor: { type: ['integer', 'string'], description: 'Optional cursor from a previous call.' },
    },
    required: ['processId'],
    additionalProperties: false,
  },
  process_stop: processIdSchema,
  process_restart: processIdSchema,
  git_status: emptySchema,
  git_diff: {
    type: 'object',
    properties: { args: stringArray('Optional git diff arguments.') },
    additionalProperties: false,
  },
  git_log: {
    type: 'object',
    properties: { args: stringArray('Optional git log arguments.') },
    additionalProperties: false,
  },
  git_branch: {
    type: 'object',
    properties: { args: stringArray('Git branch arguments.') },
    additionalProperties: false,
  },
  git_commit: {
    type: 'object',
    properties: {
      message: stringProp('Commit message.'),
      args: stringArray('Additional git commit arguments.'),
    },
    required: ['message'],
    additionalProperties: false,
  },
  git_push: {
    type: 'object',
    properties: {
      remote: stringProp('Optional Git remote name.'),
      branch: stringProp('Optional branch/ref to push.'),
      args: stringArray('Additional git push arguments.'),
    },
    additionalProperties: false,
  },
  change_begin: {
    type: 'object',
    properties: { name: stringProp('Optional change-set name.') },
    additionalProperties: false,
  },
  change_status: changeSetIdSchema,
  change_commit: changeSetIdSchema,
  change_rollback: changeSetIdSchema,
  approval_status: approvalIdSchema,
  approval_wait: approvalIdSchema,
  approval_cancel: approvalIdSchema,
  skills_list: {
    type: 'object',
    properties: {
      query: stringProp('Optional case-insensitive skill name or description filter.'),
      offset: nonNegativeInteger('Result offset.'),
      limit: nonNegativeInteger('Maximum number of skills to return.'),
    },
    additionalProperties: false,
  },
  skill_read: {
    type: 'object',
    properties: {
      source: skillSource,
      name: stringProp('Skill name.'),
      file: stringProp('Optional relative file within the skill package.'),
    },
    required: ['name'],
    additionalProperties: false,
  },
  skill_write: {
    type: 'object',
    properties: {
      source: skillSource,
      name: stringProp('Existing skill name.'),
      file: stringProp('Optional relative file within the skill package. Defaults to SKILL.md.'),
      content: stringProp('UTF-8 file content to write.'),
    },
    required: ['name', 'content'],
    additionalProperties: false,
  },
  instructions_read: emptySchema,
  instructions_write: {
    type: 'object',
    properties: {
      source: skillSource,
      content: stringProp('UTF-8 AGENTS.md content to write.'),
    },
    required: ['source', 'content'],
    additionalProperties: false,
  },
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
    required: [
      'processId',
      'cursor',
      'lines',
      'state',
      'exitCode',
      'signal',
      'finishedAt',
      'eof',
    ],
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
  file_write: 'Replace file content in the active workspace with optional expected-hash protection.',
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
  process_logs: 'Read logs and terminal state from a managed process owned by the active workspace.',
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
    inputSchema: schemas[name] ?? emptySchema,
    outputSchema: outputSchemas[name] ?? anyObjectSchema,
    annotations: {
      readOnlyHint: readOnly.has(name),
      destructiveHint: destructive.has(name),
      idempotentHint: readOnly.has(name),
      openWorldHint: openWorld.has(name),
    },
  }));
}
