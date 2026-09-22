import type { AevraToolName } from './registry.js';

/**
 * Tool descriptions, kept apart from `registry.ts` so that file stays inside
 * its line budget. Split out when the desktop tool descriptions pushed
 * `registry.ts` over the 350-line cap.
 */
export const toolDescriptions: Partial<Record<AevraToolName, string>> = {
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
  browser_execute_script:
    'Execute a bounded Playwright-like script against one browser tab as a single policy-checked action batch; arbitrary JavaScript is not evaluated.',
  control_observe:
    'Observe one browser tab or desktop window as a bounded semantic control surface with owner-bound references.',
  control_execute:
    'Execute a strict bounded ControlPlan locally across previously observed surfaces, revalidating targets and policy between steps.',
  control_plan_status: 'Read owner-bound status and terminal result for one control plan.',
  control_plan_cancel:
    'Cancel future steps of one owner-bound control plan without claiming already-dispatched external effects were rolled back.',
  desktop_act_many:
    'Execute an ordered batch of semantic desktop provider actions without synthesizing host cursor, keyboard, clipboard, or focus input.',
  desktop_status: 'Show the current Aevra desktop session, connection, and window state.',
  desktop_connect: 'Connect to the local Aevra desktop control helper for this session.',
  desktop_disconnect: 'Disconnect the local Aevra desktop control session.',
  desktop_apps: 'List apps in scope for desktop.control, resolved from the current desktop policy.',
  desktop_windows: 'List top-level desktop windows visible to the connected desktop session.',
  desktop_describe:
    'Read the accessibility tree of one desktop window, redacted for secret-shaped text.',
  desktop_capture: 'Take a screenshot of one desktop window.',
  desktop_click: 'Click at an element ref or screen coordinate in the focused desktop window.',
  desktop_type: 'Type text into an element ref or the focused desktop element.',
  desktop_key: 'Send a key or key combination to the focused desktop window.',
  desktop_scroll: 'Scroll an element ref or the focused desktop window.',
  desktop_invoke: 'Invoke a supported UI element in a background desktop window.',
  desktop_set_value: 'Set text value on a supported UI element in a background desktop window.',
  desktop_select: 'Select an item element in a background desktop window.',
  desktop_toggle: 'Toggle the check or toggle state of an element in a background desktop window.',
  desktop_release_window: 'Release an acquired background desktop window lease.',
};
