# Permissions, Workspace, Settings, Audit, and Session Admin Design

## Goal
Improve Aevra admin UX so permission grants are batch-oriented, workspace details are modal/table based, Settings is easier to scan, and destructive admin cleanup actions are available consistently in Web UI and CLI.

## Permissions
- Replace one-rule-at-a-time UX with an **Add rules** modal.
- Target defaults to **All connectors**. This includes configured static Bearer connectors plus connector actors visible in active MCP sessions, including OAuth clients. User can switch to **Selected connectors** and choose one or more currently connected actors.
- Scope is one of `global`, `workspace`, or `session`.
- Workspace scope allows one or more workspace selections. Session scope allows one or more active remote session selections.
- Capabilities use multi-select checkboxes for: `files.read`, `files.search`, `git.read`, `files.write`, `files.delete`, `commands.run`, `git.commit`, `git.push`, `network`.
- Matcher defaults to `*`; generated records remain ordinary permission rows, one record per actor × capability × selected scope target.
- Existing permission rules render in a data table and remain individually revocable.
- Persistent global/workspace allow rules for critical operation families remain forbidden and still require one-time approval.

## Workspaces
- Workspaces render as a compact data table.
- Opening a workspace shows one detail modal with all sections visible; no collapsible sections.
- External mounts mean directories outside the primary workspace root mapped into logical paths. A workspace can have multiple mounts.
- External mounts render as a table with logical path, local root, capabilities, sensitivity policy, and removal action.
- Actor admission is displayed in the same detail modal and can be added/updated there.

## Settings
- Keep **Remote Access** behavior/layout intact.
- Re-layout every other settings area into clearer grouped panels with compact forms and data tables where the data is list-shaped: Execution, Command-family overrides, Network rules, Environment profiles, Secret references, and Configuration/export.
- Preserve existing APIs and semantics.

## Audit cleanup
- Add Web UI action and CLI command: `aevra audit clear --yes`.
- Clearing audit history updates the audit-chain checkpoint to the latest event hash, then removes event rows so future events continue a verifiable chain.
- Require explicit confirmation in Web UI and `--yes` in CLI.

## Session cleanup
- Add Web UI action and CLI command: `aevra sessions revoke-others --yes`.
- Revoke remote MCP sessions except connector sessions authenticated through Aevra OAuth (`oauth:` actors) or static connector tokens (`connector:` actors).
- Revoke every local admin session except the admin session performing the request.
- This keeps the current admin control path and currently connected AI connector clients alive while removing other/stale sessions.

## Backend shape
Add focused bulk-admin endpoints before the existing admin API router:
- `POST /api/permissions/bulk`
- `DELETE /api/audit`
- `POST /api/sessions/revoke-others`
- `GET /api/workspaces/:id/admissions`

Keep existing single-record APIs for compatibility. All new mutations obey Safe Mode.

## Web implementation strategy
Load an additional `admin-enhancements.js` and `admin-enhancements.css` from `index.html`. The enhancement module watches the active page and replaces only Permissions, Workspaces, Sessions, Audit, and non-Remote-Access Settings presentation after the existing page renderer finishes. This avoids a risky wholesale rewrite of the current monolithic `app.js` while preserving existing Remote Access handlers.

## Testing
- Unit test audit clear/checkpoint behavior.
- Integration test bulk permission generation, critical-rule rejection, Safe Mode behavior, admission listing, audit deletion, and revoke-others preservation rules.
- CLI argument tests for both new commands and confirmation requirements.
- Web asset/syntax tests cover the enhanced admin shell.
- Existing tests must remain unchanged in behavior.
