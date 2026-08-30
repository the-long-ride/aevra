import {
  approvalIdSchema,
  changeSetIdSchema,
  commandProperties,
  emptySchema,
  executionMode,
  nonNegativeInteger,
  processIdSchema,
  skillSource,
  stringArray,
  stringProp,
  workspaceEmptySchema,
  workspaceTargetProperties,
  type JsonSchema,
} from './registry-schema-parts.js';

export type { JsonSchema } from './registry-schema-parts.js';
export { emptySchema } from './registry-schema-parts.js';

export const inputSchemas: Record<string, JsonSchema> = {
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
    properties: {
      ...workspaceTargetProperties,
      path: stringProp('Logical workspace path to list. Defaults to /.'),
    },
    additionalProperties: false,
  },
  file_read: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
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
      ...workspaceTargetProperties,
      path: stringProp('Logical workspace path to search. Defaults to /.'),
      query: stringProp('Text to search for inside the active workspace.'),
    },
    required: ['query'],
    additionalProperties: false,
  },
  file_create: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
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
      ...workspaceTargetProperties,
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
      ...workspaceTargetProperties,
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
      ...workspaceTargetProperties,
      from: stringProp('Existing logical workspace path.'),
      to: stringProp('Destination logical workspace path.'),
    },
    required: ['from', 'to'],
    additionalProperties: false,
  },
  file_delete: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      path: stringProp('Logical workspace path to delete.'),
      recursive: { type: 'boolean', description: 'Allow recursive directory deletion.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  command_run: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
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
      ...workspaceTargetProperties,
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
      ...workspaceTargetProperties,
      name: stringProp('Optional human-readable name for this managed process.'),
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
  process_list: workspaceEmptySchema,
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
  git_status: workspaceEmptySchema,
  git_add: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      paths: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Logical paths to stage.',
      },
      all: {
        type: 'boolean',
        description: 'Stage all tracked and untracked changes (git add -A); ignores paths.',
      },
    },
    additionalProperties: false,
  },
  git_diff: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      args: stringArray('Optional git diff arguments.'),
      short: {
        type: 'boolean',
        description: 'Return a compact --stat summary instead of the full patch text.',
      },
    },
    additionalProperties: false,
  },
  git_log: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      args: stringArray('Optional git log arguments.'),
    },
    additionalProperties: false,
  },
  git_branch: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      args: stringArray('Git branch arguments.'),
    },
    additionalProperties: false,
  },
  git_commit: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      message: stringProp('Commit message.'),
      args: stringArray('Additional git commit arguments.'),
    },
    required: ['message'],
    additionalProperties: false,
  },
  git_push: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      remote: stringProp('Optional Git remote name.'),
      branch: stringProp('Optional branch/ref to push.'),
      args: stringArray('Additional git push arguments.'),
    },
    additionalProperties: false,
  },
  change_begin: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      name: stringProp('Optional change-set name.'),
    },
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
