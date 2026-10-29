import { operationGetInputSchema, operationListInputSchema } from './operation-tools.js';
import { fastLaneInputSchemas } from './fast-lane-schemas.js';
import { emptySchema, inputSchemas, type JsonSchema } from './registry-input-schemas.js';
import { anyObjectSchema, outputSchemas } from './registry-output-schemas.js';
import { toolDescriptions } from './registry-descriptions.js';
import { filesDownloadInputSchema, filesUploadInputSchema } from './registry-transfer-schemas.js';
import { searchInputSchema } from './search-tool.js';

export const STABLE_TOOL_NAMES = [
  'aevra_status',
  'control_access_status',
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
  'files_download',
  'files_upload',
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
  'browser_execute_script',
  'browser_logs',
  'control_observe',
  'control_execute',
  'control_plan_status',
  'control_plan_cancel',
  'desktop_act_many',
  'desktop_status',
  'desktop_connect',
  'desktop_disconnect',
  'desktop_apps',
  'desktop_request_access',
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
  'notes_list',
  'notes_read',
  'notes_delete',
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

const operationInputs: Partial<Record<AevraToolName, JsonSchema>> = {
  operation_get: operationGetInputSchema,
  operation_list: operationListInputSchema,
  files_download: filesDownloadInputSchema,
  files_upload: filesUploadInputSchema,
};

const readOnly = new Set<AevraToolName>([
  'aevra_status',
  'control_access_status',
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
  'control_observe',
  'control_plan_status',
  'notes_list',
  'notes_read',
]);
// `destructive` here means "irreversible or unbounded-consequence", not
// merely "mutates something" -- file_delete, git_push, change_rollback,
// skill_write, and instructions_write all destroy or publish something this
// codebase cannot undo. The four desktop input tools belong beside them: a
// click, keystroke, or scroll drives an arbitrary GUI Aevra has no model of,
// so it can trigger anything that GUI exposes -- submitting a form, closing
// a document without saving, confirming a purchase, deleting a file through
// a file manager -- with no transaction to roll back and no diff to review
// first, unlike a file write or a sandboxed command. files_download belongs
// here too: it can overwrite files with bytes the agent chose.
const destructive = new Set<AevraToolName>([
  'file_delete',
  'files_download',
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
  'control_execute',
  'desktop_act_many',
  'notes_delete',
]);
// `openWorld` marks a tool whose effect reaches outside the workspace
// sandbox this codebase can see and reason about. The four desktop input
// tools qualify for the same reason command_run/shell_run/process_start do:
// they drive the live OS desktop, not workspace-scoped state, so their
// effect is on whatever application happens to be focused (or, for a
// coordinate click, whatever the point resolves to) -- entirely outside
// this codebase's own boundary. files_download fetches arbitrary URLs;
// files_upload hands file bytes to the agent, inline or by public link.
const openWorld = new Set<AevraToolName>([
  'files_download',
  'files_upload',
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
  'control_execute',
  'desktop_act_many',
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
    // files_upload keeps the open schema: its first reply may be an approval-pending object.
    outputSchema: outputSchemas[name] ?? anyObjectSchema,
    annotations: {
      readOnlyHint: readOnly.has(name),
      destructiveHint: destructive.has(name),
      idempotentHint: readOnly.has(name),
      openWorldHint: openWorld.has(name),
    },
  }));
}
