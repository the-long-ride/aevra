# OAuth Workspace Grants and Dense Admin UI Design

## Goal

Fix the ChatGPT reconnect bug where `workspace_select` succeeds but the next MCP call loses the active workspace, make workspace read approval happen once per OAuth connection and workspace, surface endpoint-test results in toasts, and make list-heavy admin pages denser and more responsive.

## Root Cause

Aevra intentionally creates a fresh security session for every MCP `initialize`. Workspace leases are currently attached only to that security session. When ChatGPT reconnects or reinitializes, the new session has no lease, so `workspace_current` becomes `null` and file tools return `SESSION_WORKSPACE_REQUIRED` even though the previous session successfully selected the workspace.

OAuth access/refresh tokens currently use the registered OAuth client ID as `subject`. That identity is too broad for a connection-scoped workspace grant because separate authorizations from the same registered ChatGPT client would share it.

## Security Model

### OAuth connection identity

Each successful OAuth authorization creates a unique grant subject. Access tokens and refresh tokens issued from that authorization keep the same subject across refresh rotation. A new OAuth authorization receives a different subject.

### Connection-scoped workspace grants

A `SessionManager` keeps ephemeral workspace grants in memory keyed by OAuth subject and workspace ID. A grant records the capability profile approved for that workspace. The manager also remembers the most recently active approved workspace for that OAuth subject.

Approving `workspace_select` grants the built-in `read-only` profile for that OAuth connection and workspace. This is intentionally narrower than the current `developer` profile: the approval means ChatGPT may read/search the workspace, not write files or run commands.

A fresh MCP security session for the same OAuth subject automatically receives a fresh workspace lease for the last active approved workspace. Switching to another already-approved workspace does not prompt again. Switching to a workspace not yet approved for that OAuth subject creates one local workspace-access approval request.

Connection workspace grants are memory-only and are cleared on Aevra restart. A new OAuth authorization therefore requires fresh workspace approval. Static connector bindings keep their existing behavior and do not use OAuth connection grants.

Mutation capabilities remain unchanged. File writes/deletes, commands, process starts, Git mutations, network access, and other gated operations continue to require their existing capabilities and approval rules.

## Approval Flow

`workspace_select` first evaluates existing local auto-admission and connector bindings. If neither applies, it checks the OAuth connection grant for that workspace. If already granted, selection succeeds immediately.

If approval is needed, requests are deduplicated by OAuth subject + workspace while pending or approved. The approval payload carries the OAuth connection subject so a reconnect can resume the same approval even if the original MCP session ID changed.

When local approval is accepted, `approval_wait`, a retry of `workspace_select`, or another compatible resume path may complete it from a fresh MCP session as long as actor + OAuth subject + workspace still match. Completion records the connection grant and creates the current session lease.

Completed workspace-access tickets remain history only; they do not create new permission rules and do not cause repeated prompts for the same OAuth connection/workspace.

## Remote Access Toasts

The Cloudflare endpoint test keeps its inline result. The same concrete result is also shown as a toast:

- reachable: `Endpoint reachable (HTTP 200)` (or the actual status)
- unreachable: the returned reachability failure reason, as an error toast

The generic `Remote endpoint checked` toast is not used for this action.

## Compact Admin Lists

List-heavy tabs use one visual pattern: compact rows with consistent columns, small badges, right-aligned actions, and optional expandable details. Dense rows target roughly 34–40 px on desktop so more data fits in the viewport.

### Workspaces

Workspace registration is collapsed behind an Add workspace control. Each workspace row shows name, root, mount count, and actions. Mount/admission controls are kept inside expandable details rather than occupying the viewport by default.

### Approvals

Pending approvals appear first and remain visually prominent. Workspace-access approvals expose only Allow and Deny. Other operation approvals retain their allowed scopes. Completed/denied/expired approvals move to compact history rows showing type, actor, workspace, risk, state, and time.

### Permissions

Rows show effect, capability, matcher, scope/workspace, and revoke action. Create-rule controls are collapsed by default.

### Sessions

Rows show actor/session, active workspace, activity time, and revoke. Workspace switching lives in expandable row details.

### Connectors

Rows show connector name, created time, last-used time, and revoke. Bearer-token creation is collapsed by default.

### Processes

Rows show process ID, workspace, lifecycle/ownership, and compact stop/restart/forget actions. Detached warnings appear as expanded detail text rather than making every row tall.

### Changes

Rows show change-set name, workspace, state, and available commit/rollback actions. Rename is an expandable row detail.

### Audit

Audit uses a dense filterable list with local time, operation, actor, and target visible in columns.

## Responsive Behavior

Desktop uses multi-column dense rows and sticky list headers. Tablet hides or compresses secondary columns and lets action groups wrap. Mobile converts each row into a compact two-column/stacked record without horizontal scrolling; destructive/primary actions remain reachable with touch-sized targets.

The app header remains sticky above all content.

## Testing

Regression coverage must reproduce the ChatGPT sequence:

1. OAuth authorization and token issuance.
2. MCP initialize A.
3. `workspace_select` requires local approval.
4. Local Allow.
5. Resume/retry succeeds and file access works.
6. MCP initialize B with the same OAuth grant.
7. `workspace_current` still resolves the workspace automatically.
8. `file_list` succeeds.
9. No second workspace-access approval is created.

Additional tests cover a second OAuth authorization requiring approval again, a different workspace requiring its own approval, read-only capability isolation, pending-request deduplication across reconnects, endpoint-test toast copy, and dense/responsive admin-list markup.
