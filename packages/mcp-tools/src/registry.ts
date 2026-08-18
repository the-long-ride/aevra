export const STABLE_TOOL_NAMES=['aevra_status','workspace_list','workspace_select','workspace_current','file_list','file_read','file_search','file_create','file_write','file_patch','file_move','file_delete','command_run','shell_run','process_start','process_list','process_logs','process_stop','process_restart','git_status','git_diff','git_log','git_branch','git_commit','git_push','change_begin','change_status','change_commit','change_rollback','approval_status','approval_wait','approval_cancel','skills_list','skill_read','instructions_read'] as const;
export type AevraToolName=typeof STABLE_TOOL_NAMES[number];

type JsonSchema={type:'object';properties?:Record<string,unknown>;required?:string[];additionalProperties?:boolean};
type ToolAnnotations={readOnlyHint?:boolean;destructiveHint?:boolean;idempotentHint?:boolean;openWorldHint?:boolean};
type ToolDescriptor={name:AevraToolName;description:string;inputSchema:JsonSchema;annotations:ToolAnnotations};

const emptySchema:JsonSchema={type:'object',properties:{},additionalProperties:false};
const stringProp=(description:string)=>({type:'string',description});
const nonNegativeInteger=(description:string)=>({type:'integer',minimum:0,description});

const schemas:Partial<Record<AevraToolName,JsonSchema>>={
  aevra_status:emptySchema,
  workspace_list:emptySchema,
  workspace_select:{type:'object',properties:{workspace:stringProp('Workspace name or ID to select for this MCP session.'),drainTimeoutMs:nonNegativeInteger('Graceful drain timeout before switching workspace, in milliseconds.')},required:['workspace'],additionalProperties:false},
  workspace_current:emptySchema,
  file_list:{type:'object',properties:{path:stringProp('Logical workspace path to list. Defaults to /.')},additionalProperties:false},
  file_read:{type:'object',properties:{path:stringProp('Logical workspace file path to read.'),offset:nonNegativeInteger('Optional character offset for a partial read.'),length:nonNegativeInteger('Optional maximum number of characters to return.')},required:['path'],additionalProperties:false},
  file_search:{type:'object',properties:{path:stringProp('Logical workspace path to search. Defaults to /.'),query:stringProp('Text to search for inside the active workspace.')},required:['query'],additionalProperties:false},
  shell_run:{type:'object',properties:{script:stringProp('Shell script to execute inside the active workspace.'),shell:{type:'string',enum:['auto','powershell','bash','sh'],description:'Shell interpreter. auto uses bash in strict sandbox, PowerShell on Windows host, and bash on Unix-like host.'},executionMode:{type:'string',enum:['sandbox','host'],description:'Execution mode. Defaults to sandbox; host execution requires stronger local approval.'},timeoutMs:{type:'integer',minimum:1,maximum:86400000,description:'Execution timeout in milliseconds, up to 24 hours.'},env:{type:'object',additionalProperties:{type:'string'},description:'Environment variables injected only into the child process.'},networkDestinations:{type:'array',items:{type:'string'},description:'Optional network destinations subject to Aevra network capability and approval policy.'}},required:['script'],additionalProperties:false},
  process_list:emptySchema,
  process_logs:{type:'object',properties:{processId:stringProp('Managed process ID.'),cursor:{description:'Optional log cursor returned by a previous process_logs call.'}},required:['processId'],additionalProperties:false},
  git_status:emptySchema,
  git_diff:{type:'object',properties:{args:{type:'array',items:{type:'string'},description:'Optional git diff arguments.'}},additionalProperties:false},
  git_log:{type:'object',properties:{args:{type:'array',items:{type:'string'},description:'Optional git log arguments.'}},additionalProperties:false},
  change_status:{type:'object',properties:{changeSetId:stringProp('Change-set ID to inspect.')},required:['changeSetId'],additionalProperties:false},
  approval_status:{type:'object',properties:{requestId:stringProp('Approval request ID to inspect.')},required:['requestId'],additionalProperties:false},
  skills_list:{type:'object',properties:{query:stringProp('Optional case-insensitive skill name or description filter.'),offset:nonNegativeInteger('Result offset.'),limit:nonNegativeInteger('Maximum number of skills to return.')},additionalProperties:false},
  skill_read:{type:'object',properties:{source:{type:'string',enum:['user','workspace'],description:'Skill source.'},name:stringProp('Skill name.'),file:stringProp('Optional file within the skill package.')},required:['name'],additionalProperties:false},
  instructions_read:emptySchema,
};

const readOnly=new Set<AevraToolName>(['aevra_status','workspace_list','workspace_select','workspace_current','file_list','file_read','file_search','process_list','process_logs','git_status','git_diff','git_log','change_status','approval_status','skills_list','skill_read','instructions_read']);
const destructive=new Set<AevraToolName>(['file_delete','git_push','change_rollback']);
const openWorld=new Set<AevraToolName>(['git_push','command_run','shell_run','process_start']);

const descriptions:Partial<Record<AevraToolName,string>>={
  aevra_status:'Show the current Aevra MCP session, active workspace, and granted capabilities.',
  workspace_list:'List workspaces already registered by the local Aevra administrator.',
  workspace_select:'Select an already-registered workspace for this MCP session without modifying workspace files.',
  workspace_current:'Show the workspace currently selected for this MCP session.',
  file_list:'List files and directories under a logical path in the active workspace.',
  file_read:'Read a file from the active workspace, with optional partial-read offsets.',
  file_search:'Search for text inside files in the active workspace.',
  shell_run:'Run a PowerShell, bash, or sh script in the active workspace through Aevra command policy, sandbox, and local approval controls.',
  process_list:'List managed processes owned by the active workspace.',
  process_logs:'Read logs from a managed process owned by the active workspace.',
  git_status:'Read Git status for the active workspace.',
  git_diff:'Read a Git diff for the active workspace.',
  git_log:'Read Git history for the active workspace.',
  change_status:'Inspect one Aevra recovery change set.',
  approval_status:'Inspect one pending or completed local approval request.',
  skills_list:'List Aevra skills available from the user and active workspace libraries.',
  skill_read:'Read one Aevra skill or one file within a skill package.',
  instructions_read:'Read merged Aevra/AGENTS.md instructions for the active workspace.',
};

export function toolDefinitions():ToolDescriptor[]{
  return STABLE_TOOL_NAMES.map(name=>({
    name,
    description:descriptions[name]??`Aevra ${name.startsWith('aevra_')?name.slice('aevra_'.length):name.replaceAll('_',' ')}`,
    inputSchema:schemas[name]??{type:'object',additionalProperties:true},
    annotations:{
      readOnlyHint:readOnly.has(name),
      destructiveHint:destructive.has(name),
      idempotentHint:readOnly.has(name),
      openWorldHint:openWorld.has(name),
    },
  }));
}
