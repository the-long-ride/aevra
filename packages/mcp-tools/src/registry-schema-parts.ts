export type JsonSchema = Record<string, unknown>;

export const emptySchema: JsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};
export const stringProp = (description: string) => ({ type: 'string', description });
export const nonNegativeInteger = (description: string) => ({
  type: 'integer',
  minimum: 0,
  description,
});
export const stringArray = (description: string) => ({
  type: 'array',
  items: { type: 'string' },
  description,
});
export const stringMap = (description: string) => ({
  type: 'object',
  additionalProperties: { type: 'string' },
  description,
});
export const workspaceTargetProperties = {
  workspace: stringProp('Workspace name for this operation.'),
  workspaceId: stringProp('Workspace ID for this operation.'),
};
export const workspaceEmptySchema: JsonSchema = {
  type: 'object',
  properties: { ...workspaceTargetProperties },
  additionalProperties: false,
};
export const skillSource = {
  type: 'string',
  enum: ['user', 'workspace'],
  description: 'Skill source.',
};
export const executionMode = {
  type: 'string',
  enum: ['sandbox', 'host'],
  description: 'Execution mode. Defaults according to Aevra execution settings.',
};
export const commandProperties = {
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
export const processIdSchema: JsonSchema = {
  type: 'object',
  properties: { processId: stringProp('Managed process ID.') },
  required: ['processId'],
  additionalProperties: false,
};
export const changeSetIdSchema: JsonSchema = {
  type: 'object',
  properties: { changeSetId: stringProp('Change-set ID.') },
  required: ['changeSetId'],
  additionalProperties: false,
};
export const approvalIdSchema: JsonSchema = {
  type: 'object',
  properties: { requestId: stringProp('Approval request ID.') },
  required: ['requestId'],
  additionalProperties: false,
};
