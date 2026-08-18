# Live Dashboard, Request Presentation, and Coding Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Aevra requests descriptive and notification-friendly, make Dashboard runtime data live, improve completed onboarding layout, show active connections, restore provider guide actions, and allow OAuth coding sessions to request controlled capability upgrades.

**Architecture:** Core owns sanitized approval presentation and one runtime Dashboard snapshot. The web UI consumes those stable view models and polls only the runtime snapshot while Dashboard is active. Missing OAuth workspace capabilities request the minimum connection-scoped built-in profile and resume the original frozen operation after approval; existing worker/command/security paths stay authoritative.

**Tech Stack:** TypeScript, Node.js, SQLite repositories, browser JavaScript/CSS, existing Aevra MCP/approval/session pipeline.

**Spec:** `docs/superpowers/specs/2026-08-18-live-dashboard-request-presentation-coding-access-design.md`

## Global Constraints

- Keep `main` untouched; implement on `fix/chatgpt-mcp-xai-ui`.
- Do not render raw approval payloads in the browser.
- Environment secret values and OAuth tokens must never enter request presentation.
- Workspace admission remains read-only by default.
- Coding grants are connection + workspace scoped, in-memory, reconnect-safe, and restart-cleared.
- Static connectors do not auto-escalate.
- Dashboard runtime data resets on restart and refreshes every 2 seconds while visible.
- `shell_run` must execute through the existing command pipeline.

---

### Task 1: Sanitized approval presentation

**Files:**
- Create: `apps/core/src/approvals/request-presentation.ts`
- Modify: `apps/core/src/approvals/approval-service.ts`
- Modify: `apps/core/src/admin/routes/api.ts`
- Test: `apps/core/test/request-presentation.unit.test.ts`

**Interfaces:**
- Produces: `presentApproval(ticket)` returning `{title,action,target,preview?}`.
- `/api/approvals` returns each ticket plus `presentation`.

- [ ] Write tests covering workspace access, skills access, file delete, command/shell command preview, git push, coding access, and secret/env omission.
- [ ] Implement sanitized ticket presentation with bounded previews and DLP redaction.
- [ ] Use the presentation for Core OS notification title/body.
- [ ] Enrich `/api/approvals` rows with presentation without changing persisted ticket shape.

### Task 2: Connection-scoped capability profile upgrades

**Files:**
- Modify: `apps/core/src/policy/capabilities.ts`
- Modify: `apps/core/src/sessions/session-manager.ts`
- Modify: `apps/core/src/approvals/approval-service.ts`
- Modify: `apps/core/src/runtime.ts`
- Modify: `packages/mcp-tools/src/service.ts`
- Test: `packages/mcp-tools/test/capability-upgrade.integration.test.ts`
- Test: `apps/core/test/session-manager.unit.test.ts` or closest existing session integration file

**Interfaces:**
- Add builtin profile `coding-session` with read/search/git-read/write/commands.
- Add `SessionManager.grantConnectionWorkspaceProfile(sessionId,workspaceId,profileId)` behavior via the existing connection grant mechanism.
- Add approval family `workspace:capability-upgrade` with payload `{tool:'workspace_capability_upgrade',profileId,workspaceId,requestedCapability,original:{tool,args}}`.

- [ ] Test read-only OAuth session invoking `file_write` produces one coding upgrade request rather than dead-end `CAPABILITY_REQUIRED`.
- [ ] Test duplicate attempts/reconnect before approval reuse the same ticket.
- [ ] Test approval upgrades all live sessions sharing the OAuth grant and reconnect restores the upgraded lease.
- [ ] Test `approval_wait` resumes the original operation after upgrade.
- [ ] Test `commands.run` maps to coding-session, `git.commit`/`network` to developer, and `files.delete`/`git.push` to full-workspace.
- [ ] Test static connectors still receive `CAPABILITY_REQUIRED` rather than an upgrade request.
- [ ] Implement minimum-profile lookup and upgrade request/resume logic.
- [ ] Ensure approval persistence scopes do not create global/workspace permission rules for capability-upgrade tickets.

### Task 3: Repair `shell_run` service dispatch

**Files:**
- Modify: `packages/mcp-tools/src/service.ts`
- Test: `packages/mcp-tools/test/shell-run.integration.test.ts`

**Interfaces:**
- Consumes existing `buildShellCommand` and `shellRiskFloor` from `shell-command.ts`.
- `shell_run` delegates into the same command policy path as `command_run` with a HIGH risk floor.

- [ ] Test `shell_run` is reachable through `McpToolService.call`.
- [ ] Test missing `commands.run` first produces capability upgrade.
- [ ] Test after capability upgrade the shell operation still receives its normal HIGH-risk operation approval.
- [ ] Implement dispatch without using `shell:true`.

### Task 4: One runtime Dashboard snapshot

**Files:**
- Modify: `apps/core/src/runtime.ts`
- Modify: `apps/core/src/admin/routes/api.ts`
- Test: `apps/core/test/admin-control-plane.integration.test.ts`

**Interfaces:**
- Add runtime `startedAt` to `/api/status`.
- Add `GET /api/dashboard/runtime` returning `{generatedAt,startedAt,status,metrics,pending,stats,activeConnections,connectors,recent}`.

- [ ] Test runtime snapshot counts sessions, leases, pending approvals/OAuth requests, processes, changes, tool metrics, connectors, and active connections.
- [ ] Test authentication type derivation for OAuth and connector sessions.
- [ ] Implement snapshot composition from existing in-memory/runtime services without new persistence.

### Task 5: Dashboard lifecycle and live refresh

**Files:**
- Modify: `apps/web/app-v2.js`
- Modify: `apps/web/app-v2.css`
- Modify: `apps/web/ui-runtime.js`
- Test: `scripts/test/web-dashboard-v2.test.mjs`

**Interfaces:**
- Dashboard initial render uses `/api/dashboard/runtime` plus Cloudflare/onboarding/workspace configuration data.
- While Dashboard is active, a 2-second timer refreshes runtime cards/tables without rebuilding Remote Access forms or stealing focus.

- [ ] Test incomplete onboarding keeps Remote Access first and Onboarding near the top.
- [ ] Test completed onboarding moves to the bottom, collapsed, with Remote Access inside it.
- [ ] Test Active connections section exists and uses the shared DataTable.
- [ ] Test ChatGPT/Claude/Gemini each expose an Open guide action to the existing guide slug.
- [ ] Implement stable DOM targets for runtime stats/tables and patch them every 2 seconds.
- [ ] Stop Dashboard runtime polling when another page is activated.

### Task 6: Requests drawer details and notifications

**Files:**
- Modify: `apps/web/app-v2.js`
- Modify: `apps/web/app-v2.css`
- Modify: `apps/web/ui-runtime.js`
- Test: `scripts/test/web-dashboard-v2.test.mjs`

**Interfaces:**
- Request cards consume `item.presentation`.
- Toast/browser notification copy uses the same presentation text.

- [ ] Test request cards show action, target, and preview when present.
- [ ] Test coding-upgrade request uses Allow/Deny only.
- [ ] Test Requests drawer exposes `Enable browser notifications` when Notification permission is not granted.
- [ ] Test browser notification request only occurs from that explicit button click.
- [ ] Implement detailed toast/browser notification text from presentation.

### Task 7: Verification

**Files:**
- Verify all files above.

- [ ] Run focused unit/integration/web tests when an execution environment is available.
- [ ] Run build/typecheck when available.
- [ ] Inspect automatic GitHub checks only; do not manually trigger, rerun, or cancel CI.
- [ ] Compare branch head against pre-change base and confirm `main` was not modified.
