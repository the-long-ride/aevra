# Workspace Approval and Responsive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make remote workspace-admission requests visible/actionable locally, keep Remote Access permanently visible after onboarding, add a sticky status-dot header, and improve Connect-an-AI/responsive layout.

**Architecture:** Workspace admission becomes a first-class ApprovalService ticket rather than a bare `approval_required` tool result. The web shell keeps polling the same `/api/approvals` + `/api/status` endpoints, but renders admission-specific controls and compact live status chips. Completed onboarding collapses only non-persistent setup sections; Remote Access remains outside the details container.

**Tech Stack:** Node.js 22+, TypeScript, vanilla browser JavaScript/CSS, SQLite-backed Aevra services, MCP tools, Node test runner.

## Global Constraints

- Continue on `fix/chatgpt-mcp-xai-ui`; do not modify `main`.
- Do not change GitHub Actions workflow configuration or manually re-run CI.
- Keep current navigation content.
- Remote Access stays visible after onboarding completion.
- Workspace registration and persistent actor/workspace admission remain local-admin-only.
- Workspace admission approval is one-time/session admission; it must not create persistent operation permission rules.
- Worker means the isolated local Execution Worker, not the Cloudflare tunnel.
- Header statuses: green pulse running/reachable, amber pulse starting/checking/reconnecting, red solid failed/not running, gray solid unconfigured/intentional unavailable.
- All displayed date/time values continue using browser/device local time.
- UI placeholders remain generic and must not use a personal/local folder example.

---

### Task 1: Turn workspace admission into a real approval ticket

**Files:**
- Modify: `packages/mcp-tools/test/service.integration.test.ts`
- Modify: `packages/mcp-tools/src/service.ts`

**Interfaces:**
- Consumes: `ApprovalService.request()`, `ApprovalService.list()`, `ApprovalService.resume()`, `SessionManager.switchWorkspace()`.
- Produces: `workspace_select` returns either `{status:'selected', ...}` or `{status:'approval_pending', requestId, ...}`; `approval_wait` can resume an approved workspace admission ticket.

- [ ] **Step 1: Add a failing integration test for unknown actor workspace admission**

Add a fixture with `ApprovalRepository`, `AuditRepository`, `AuditService`, and `ApprovalService`. Assert the first `workspace_select` for an actor without a workspace mapping creates one PENDING ticket with `operation.family === 'workspace:select'`, returns `approval_pending`, and exposes a request ID.

- [ ] **Step 2: Add duplicate/reuse assertions**

Call `workspace_select` again for the same session/workspace before approval. Assert the same request ID is returned and only one PENDING admission ticket exists.

- [ ] **Step 3: Add approved-resume assertions**

Approve the ticket with scope `once`, call `workspace_select` or `approval_wait`, then assert a developer-profile lease is active for the requested workspace and the result is `selected`.

- [ ] **Step 4: Run the targeted test and confirm RED**

Run: `node scripts/run-ts-tests.mjs packages/mcp-tools/test/service.integration.test.ts`

Expected: FAIL because no ApprovalService ticket is created for `workspace_select`.

- [ ] **Step 5: Implement admission ticket creation/reuse/resume**

In `McpToolService`, extract workspace selection into a focused helper. For unknown actor/workspace mappings:

```ts
const existing=this.approvals?.list().find(ticket=>
  ticket.sessionId===sessionId&&
  ticket.workspaceId===workspace.id&&
  ticket.operation.family==='workspace:select'&&
  ['PENDING','APPROVED'].includes(ticket.state)
);
```

Freeze payload fields `tool:'workspace_select'`, `workspaceId`, `profileId:'developer'`, and `drainTimeoutMs`. Use a MEDIUM admission ticket with an `argsHash` over the workspace ID/profile. Reuse an existing PENDING ticket; resume APPROVED tickets.

- [ ] **Step 6: Specialize approval resume for workspace admission**

Before generic lease-based revalidation, detect `ticket.operation.family === 'workspace:select'`. Revalidate session/actor/workspace existence, then call `sessions.switchWorkspace(sessionId, workspaceId, profileId, drainTimeoutMs)`. Return the same selected response used by direct admission.

- [ ] **Step 7: Run the targeted test and confirm GREEN**

Run: `node scripts/run-ts-tests.mjs packages/mcp-tools/test/service.integration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

Commit message: `fix: surface workspace admission approvals`

---

### Task 2: Keep workspace admission one-time in the local approval API/UI

**Files:**
- Modify: `apps/core/test/admin-control-plane.integration.test.ts`
- Modify: `apps/core/src/admin/routes/api.ts`
- Modify: `scripts/test/web-admin-shell.test.mjs`
- Modify: `apps/web/app.js`

**Interfaces:**
- Consumes: `/api/approvals/:id/approve|deny` and `FrozenOperationTicket.operation.family`.
- Produces: admission tickets show only Allow/Deny and never create remembered operation permission rules.

- [ ] **Step 1: Add failing admin API coverage**

Create/seed a `workspace:select` ticket, POST approval with a persistent-looking scope such as `workspace`, and assert the API coerces it to `once` (or otherwise does not persist a permission rule).

- [ ] **Step 2: Add failing web-shell assertions**

Assert `approvals()` detects `workspace:select`, labels it as workspace access, and does not render session/workspace/global remembered approval buttons for that ticket.

- [ ] **Step 3: Run targeted tests and confirm RED**

Run:

```bash
node scripts/run-ts-tests.mjs apps/core/test/admin-control-plane.integration.test.ts
node --test scripts/test/web-admin-shell.test.mjs
```

- [ ] **Step 4: Implement API defense**

In `/api/approvals/:id/(approve|deny)`, detect admission tickets. Force approval scope to `once` and skip `permissions.upsert()` for `workspace:select` regardless of client-supplied scope.

- [ ] **Step 5: Implement admission-specific UI**

For a PENDING `workspace:select` ticket render actor/workspace context plus only `Deny` and primary `Allow`. Keep the existing scope buttons for normal operation approvals.

- [ ] **Step 6: Run targeted tests and confirm GREEN**

Run the two commands from Step 3.

- [ ] **Step 7: Commit**

Commit message: `fix: keep workspace admission approvals local`

---

### Task 3: Sticky live header with Core/Worker/MCP/Tunnel dots

**Files:**
- Modify: `scripts/test/web-admin-shell.test.mjs`
- Modify: `scripts/test/web-onboarding-runtime.test.mjs`
- Modify: `apps/web/app.js`
- Modify: `apps/web/ui-runtime.js`
- Modify: `apps/web/app.css`

**Interfaces:**
- Consumes: `/api/status` fields `version`, `core`, `worker`, `mcp`, `tunnel`, `tunnelReachable`, `tunnelCheckedAt`.
- Produces: header chips `<span class="health-chip" data-health="..." data-state="ok|pending|error|off">` with `.health-dot`.

- [ ] **Step 1: Add failing shell/runtime assertions**

Assert the header contains Core, Worker, MCP, Tunnel chips without literal `running` labels; runtime maps live `/api/status` values into `data-state`; CSS makes `header` sticky and defines dot state styles/pulse animation.

- [ ] **Step 2: Run web tests and confirm RED**

Run:

```bash
node --test scripts/test/web-admin-shell.test.mjs scripts/test/web-onboarding-runtime.test.mjs
```

- [ ] **Step 3: Add shell status helpers**

Implement helpers that map:

```js
Core/Worker/MCP: running => ok; starting/reconnecting => pending; unavailable/stopped/error => error/off as appropriate.
Tunnel: unconfigured => off; configured + reachable true => ok; configured + reachable false => error; configured + reachable null => pending.
```

Render only dot + label text (`Core`, `Worker`, `MCP`, `Tunnel`). Keep status/detail in `title`/ARIA text.

- [ ] **Step 4: Make runtime refresh status continuously**

Extend `refreshAppStatus()` to update all chip `data-state`/titles plus version. Call it on initial load and the existing poll interval so worker/MCP/tunnel state stays fresh.

- [ ] **Step 5: Style sticky header and dots**

Use `position:sticky; top:0; z-index` with opaque/blurred canvas background. Add green/amber pulse keyframes, red/gray solids. Update sticky nav/guide top offsets so content does not slide under the header.

- [ ] **Step 6: Run web tests and JS syntax checks**

Run:

```bash
node --check apps/web/app.js
node --check apps/web/ui-runtime.js
node --test scripts/test/web-admin-shell.test.mjs scripts/test/web-onboarding-runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: add sticky live health header`

---

### Task 4: Keep Remote Access outside completed onboarding and simplify Connect an AI

**Files:**
- Modify: `scripts/test/web-admin-shell.test.mjs`
- Modify: `scripts/test/web-onboarding-runtime.test.mjs`
- Modify: `apps/web/app.js`
- Modify: `apps/web/ui-runtime.js`
- Modify: `apps/web/app.css`

**Interfaces:**
- Produces: persistent Remote Access setup section plus collapsible non-persistent onboarding details; provider example grid for ChatGPT/Claude/Gemini.

- [ ] **Step 1: Add failing onboarding assertions**

Assert Remote Access is marked persistent and excluded from `collapseCompletedOnboarding()`. Assert the collapsible content contains only Connect an AI, Workspace, Try Aevra, Explore.

- [ ] **Step 2: Add failing Connect-an-AI assertions**

Assert Getting Started contains explicit “example” guidance, ChatGPT/Claude/Gemini provider cards in the provider grid, and does not contain the `Pairing requests` heading/column inside the Getting Started function.

- [ ] **Step 3: Run web tests and confirm RED**

Run:

```bash
node --test scripts/test/web-admin-shell.test.mjs scripts/test/web-onboarding-runtime.test.mjs
```

- [ ] **Step 4: Recompose Getting Started**

Fetch only onboarding, Cloudflare status, and workspaces. Keep Remote Access as a full-width `data-onboarding-persistent` section. Build Connect an AI with a short example-guide hint, one shared canonical endpoint, and three parallel provider example cards linking to `connect-chatgpt`, `connect-claude`, and `connect-gemini`. Remove pairing request markup from Getting Started; Approvals remains the only pairing queue UI.

- [ ] **Step 5: Fix completed-onboarding DOM move**

In `collapseCompletedOnboarding()`, select only non-persistent setup sections and insert the details container immediately after the persistent Remote Access section. Do not move Remote Access.

- [ ] **Step 6: Surface first-load pending requests**

Remove the current first-poll suppression that silently seeds `seen`. On initial polling, existing OAuth/operation/workspace-admission requests must increment Requests and produce the in-app notification/toast. Browser notifications remain conditional on existing permission.

- [ ] **Step 7: Improve responsive CSS**

Provider grid: 3 columns desktop, 2 medium, 1 narrow. Ensure header chips, Remote Access form, endpoint rows, action rows, forms, cards, and navigation do not cause horizontal overflow. Preserve mobile 44px touch targets.

- [ ] **Step 8: Run web tests and syntax checks**

Run:

```bash
node --check apps/web/app.js
node --check apps/web/ui-runtime.js
node --test scripts/test/web-admin-shell.test.mjs scripts/test/web-onboarding-runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

Commit message: `feat: refine onboarding and responsive layout`

---

### Task 5: Verify the approved pass without manually triggering CI

**Files:**
- Verify only.

- [ ] **Step 1: Run format check**

Run: `npm run format:check`

- [ ] **Step 2: Run lint**

Run: `npm run lint`

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Run unit + integration suites**

Run:

```bash
npm run test:unit
npm run test:integration
npm run test:web
```

- [ ] **Step 5: Build**

Run: `npm run build`

- [ ] **Step 6: Inspect the automatically-created workflow status only**

Do not cancel, rerun, or otherwise mutate GitHub Actions. Report whatever status exists after the final push.
