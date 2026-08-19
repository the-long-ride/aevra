# Common Dialogs, Wider Admin Pages, and Live MCP Activity Design

## Goal

Replace browser-native dialogs with a reusable React dialog system, widen each admin tab appropriately, slightly widen the Guide sidebar, make compact navigation controls square, and show sanitized real-time MCP activity on Dashboard.

## Common dialog system

Create one shared React dialog provider/component used by management pages instead of `window.alert`, `window.confirm`, or `window.prompt`.

The dialog API supports:

- message-only dialogs with one acknowledgement button;
- two-button confirmations;
- three-button choices;
- text-input prompts for existing rename/workspace/session flows.

Dialogs use the existing Aevra modal visual language, support keyboard focus, Escape/cancel behavior, and primary/danger button variants. Existing native prompt/confirm usages in Dashboard, Workspaces, Sessions, Changes, and Audit move to this common system.

## Button geometry

Text buttons keep content-driven width but must never be narrower than their control height. Compact icon/pagination buttons are true squares. Data-table pagination controls become fixed square buttons.

## Per-tab page widths

`#page` receives the active page id and uses per-tab max-widths instead of the current single 1180px cap. All desktop tabs become wider while retaining the existing full-width responsive behavior on narrower screens.

Suggested desktop caps:

- Dashboard: 1440px
- Workspaces: 1400px
- Permissions: 1400px
- Sessions: 1360px
- Processes: 1360px
- Changes: 1360px
- Audit: 1400px
- Settings: 1320px
- Guide: 1480px

The Guide chapter sidebar increases from 220px to 260px on desktop.

## Live MCP activity

Add a `Live MCP activity` section to Dashboard immediately after Runtime overview.

The Core owns an in-memory bounded MCP activity log. It records lifecycle state for MCP JSON-RPC/tool operations without recording request arguments, prompt text, file contents, command text, secrets, tokens, environment values, or tool results.

Each activity row contains only sanitized metadata:

- operation id;
- started/updated timestamps;
- actor/client identity label;
- MCP session id;
- active workspace id when available;
- kind (`tool`, `rpc`, or `session`);
- action/tool name;
- state (`running`, `success`, `error`);
- duration when finished.

Tool calls are inserted as `running` before execution and updated to `success` or `error` when execution finishes. Workspace id is refreshed after completion so workspace-selection calls can show the newly active workspace.

## Real-time transport

Expose an authenticated local-admin SSE endpoint at `/api/activity/stream`.

- It uses the existing admin-session cookie protection.
- On connect it sends the recent bounded activity snapshot, then streams updates.
- It emits periodic SSE comments as keepalives.
- Closing the browser connection unsubscribes the listener.
- No new remote/public MCP endpoint is created.

The React Dashboard uses `EventSource` to merge events by operation id. Running operations stay visible and update in place when completed. The panel shows connection state and maps workspace ids to workspace names already loaded by Dashboard.

## Retention and privacy

The activity feed is runtime-memory only and bounded; it is not a second audit store. The existing audit log remains the durable security record. The live feed intentionally excludes arguments and outputs to avoid creating a new secret-exposure surface.

## Tests

Add tests for:

- message, confirmation, three-button choice, and prompt dialog behavior;
- elimination of current browser-native dialog calls from migrated pages;
- square pagination controls / per-page page id contract;
- MCP activity log begin/update/bounded retention behavior;
- SSE route snapshot/subscription behavior;
- Dashboard EventSource merge/update rendering;
- Dashboard section ordering with Live MCP activity.
