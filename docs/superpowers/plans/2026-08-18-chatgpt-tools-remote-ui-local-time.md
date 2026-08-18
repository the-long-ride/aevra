# ChatGPT Tools, Remote Access UI, and Local Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore ChatGPT discovery of Aevra workspace/read tools, remove redundant Getting Started gateway status content, compact the Remote Access layout, and render UI timestamps in the device's local timezone.

**Architecture:** Keep the existing custom MCP server and local admin shell. Fix discovery at the tool descriptor boundary by adding truthful MCP annotations (especially `readOnlyHint`) and explicit schemas for the workspace/read path; keep session-only workspace selection read-only because it does not mutate workspace/external state. Keep server timestamps as ISO values and convert only at the browser presentation boundary with `Intl.DateTimeFormat`/`Date`, so API/storage semantics remain UTC-safe.

**Tech Stack:** Node.js 22+, TypeScript, vanilla browser JavaScript/CSS, MCP Streamable HTTP, GitHub Actions.

## Global Constraints

- Continue on `fix/chatgpt-mcp-xai-ui`; do not modify `main`.
- Preserve the existing navigation items and local-admin-only control plane.
- Remove the duplicated Local Gateway section from Getting Started; header health pills remain the gateway status surface.
- Remote Access must stay compact and retain hostname, tunnel ID, ownership, authenticate/check, save, test, canonical endpoint, and advanced Access controls.
- Every rendered date/time must use the browser/device locale and timezone; stored/API timestamps remain unchanged.
- MCP annotations must match real side effects; read-only filtering must still exclude mutating workspace/file/command/Git actions.

---

### Task 1: Restore ChatGPT read-tool discovery

**Files:**
- Modify: `packages/mcp-tools/src/registry.ts`
- Test: `packages/mcp-tools/test/registry.unit.test.ts`

**Interfaces:**
- Produces: `toolDefinitions()` descriptors with MCP `annotations` and usable `inputSchema` objects.

- [ ] Add a failing registry test asserting `workspace_list`, `workspace_select`, `workspace_current`, `file_list`, `file_read`, and `file_search` have `annotations.readOnlyHint === true`, while `file_write`, `command_run`, and `git_push` do not.
- [ ] Add assertions that workspace/read tools expose explicit JSON-schema properties instead of one unconstrained schema.
- [ ] Run the unit test and confirm the new assertions fail on the current registry.
- [ ] Implement per-tool descriptor metadata and schemas, with truthful `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` values.
- [ ] Run registry unit tests and MCP integration tests.

### Task 2: Remove duplicate Local Gateway and compact Remote Access

**Files:**
- Modify: `apps/web/app.js`
- Modify: `apps/web/app.css`
- Test: `scripts/test/web-admin-shell.test.mjs`

**Interfaces:**
- Produces: `remoteAccessMarkup()` with compact provider/status, endpoint, fields, and actions layout.

- [ ] Add failing web-shell assertions that the Getting Started HTML no longer emits a `Local Gateway` setup section and that new compact Remote Access layout class names exist.
- [ ] Run `npm run test:web` and confirm failure before implementation.
- [ ] Remove the Local Gateway section from `gettingStarted()` and remove it from completed-section bookkeeping.
- [ ] Recompose Remote Access into a compact status/header row, endpoint row, 3-field configuration grid, and aligned actions row.
- [ ] Update responsive CSS so the section is dense on desktop and becomes one column cleanly on narrow screens.
- [ ] Run web-shell tests and browser JS syntax validation.

### Task 3: Render date/time in device local timezone

**Files:**
- Modify: `apps/web/app.js`
- Test: `scripts/test/web-admin-shell.test.mjs`

**Interfaces:**
- Produces: `localDateTime(value)` that formats valid timestamps using the browser locale/timezone and safely falls back for invalid values.

- [ ] Add failing assertions for a device-local date formatter and for its use on admin session `lastUsedAt`, connector `createdAt`/`lastUsedAt`, and audit `createdAt`.
- [ ] Run `npm run test:web` and confirm failure.
- [ ] Add `localDateTime(value)` using `new Date(value).toLocaleString()` (device locale/timezone) with invalid-value fallback.
- [ ] Replace raw timestamp rendering in Sessions, Connectors, and Audit with the helper.
- [ ] Run web-shell tests and build.

### Task 4: Verify branch

**Files:**
- Verify only.

- [ ] Run `npm run format:check`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test:unit`.
- [ ] Run `npm run test:integration`.
- [ ] Run `npm run test:web`.
- [ ] Run `npm run build`.
- [ ] Confirm GitHub Actions succeeds across supported runners before reporting completion.
