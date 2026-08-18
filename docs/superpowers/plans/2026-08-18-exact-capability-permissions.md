# Exact Capability Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make remembered permission rules effective authorization for MCP connectors, replace broad profile upgrades with exact-capability approvals, improve bulk rule creation and connector selection, add platform safe-matcher guidance, and unify permission mutation toasts.

**Architecture:** Capability profiles remain baseline workspace admission bundles. `PermissionEngine` becomes the operation-level overlay and exposes an effective-access summary. `McpToolService` authorizes each operation once at the MCP boundary and passes an explicit trusted authorization context to lower-level operation execution when the baseline lease does not contain the capability. Persistent approval scopes continue to write ordinary permission rules; one-time approvals resume the frozen operation without mutating the profile.

**Tech Stack:** TypeScript, Node.js, node:sqlite, vanilla browser JavaScript/CSS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-18-exact-capability-permissions-design.md`

## Global Constraints

- Work directly on `main`; do not create a feature branch or PR.
- Existing capability profiles remain baseline admission configuration.
- Permission rules remain the only persistent exact-capability rule format; no schema migration for `permission_rules`.
- Explicit deny wins over allow; CRITICAL operations remain one-time local approval.
- `commands.run` authorization is matcher-specific; a remembered matcher never implies unrestricted commands.
- Static `connector:` and OAuth `oauth:` actors use the same exact-capability request path.
- Session-scoped rules require a live session; workspace/global rules may target offline configured connectors.
- Keep one toast implementation only, bottom-right, newest nearest the bottom edge.

---

### Task 1: Permission overlay queries and effective summary

**Files:**
- Modify: `packages/store/src/permissions.ts`
- Modify: `apps/core/src/policy/permissions.ts`
- Create: `apps/core/test/permission-effective-summary.unit.test.ts`

**Interfaces:**
- `PermissionRepository.get(id:string): any | null`
- `PermissionRepository.upsertMany(rules:any[]): any[]` executes one SQLite transaction.
- `PermissionEngine.summary(input:{workspaceId?:string;actor?:string;sessionId?:string;baselineCapabilities:Capability[]}): {effectiveCapabilities:Capability[];commandMatchers:string[]}`
- `PermissionEngine.decide(...)` preserves matcher specificity but evaluates matching deny before CRITICAL/allow behavior.

- [ ] Write failing tests proving wildcard `files.write` allow adds only `files.write`, command matcher `git:status` exposes `commands.run` plus `commandMatchers:['git:status']`, explicit deny suppresses summarized access, and CRITICAL allow still returns approval while deny still returns deny.
- [ ] Run the focused policy tests and verify RED.
- [ ] Add repository `get`/transactional `upsertMany`, applicable-rule filtering helpers inside `PermissionEngine`, deny-first decision semantics, and `summary`.
- [ ] Run focused tests and verify GREEN.
- [ ] Commit with `feat: add effective permission overlay summary`.

### Task 2: Exact-capability MCP authorization and status reporting

**Files:**
- Modify: `packages/mcp-tools/src/service.ts`
- Modify: `apps/core/src/operations/operation-service.ts`
- Modify: `apps/core/src/approvals/approval-service.ts`
- Replace/extend: `packages/mcp-tools/test/capability-upgrade.integration.test.ts`
- Modify: `packages/mcp-tools/test/service.integration.test.ts`

**Interfaces:**
- Add trusted context type near operation service: `export interface AuthorizedCapabilityContext {sessionId:string;workspaceId:string;actor:string;capability:Capability;matcher:string}`.
- Lower-level mutating operation methods accept optional final `authorization?:AuthorizedCapabilityContext`; `requiredLease` accepts the same context and permits the requested capability only when session/workspace/actor/capability match.
- `McpToolService` adds an operation-level helper that returns either an authorized context or an approval-pending response; it checks deny, baseline capability, matching allow, otherwise requests exact approval.
- Exact approval payload uses a new frozen-operation family/payload marker such as `permission:capability-request`, with the real requested operation matcher stored in `operation.family` or payload so persistent scopes create the exact ordinary rule.
- `aevra_status` returns `baselineCapabilities`, `effectiveCapabilities`, `commandMatchers`, and aliases `capabilities` to effective capabilities.

- [ ] Rewrite/add failing integration tests for read-only baseline + remembered `files.write`, exact `files.write` approval with no `commands.run`, identical static/OAuth approval behavior, read/write/delete paths, matcher-specific command authorization, deny precedence, and status output.
- [ ] Run focused MCP tests and verify RED.
- [ ] Remove `profileForCapability`/`profileCapabilities` upgrade behavior for tool capability requests while leaving workspace admission profiles intact.
- [ ] Implement the exact-capability authorization helper and use it for file read/search/write/create/move/patch/delete, command/shell, Git commit/push and read capability where missing, network, process start, and recovery operations that need capabilities.
- [ ] Pass trusted authorization context into `OperationService` for methods that currently re-check lease capabilities, without mutating the profile/lease.
- [ ] Change approval resume revalidation to consult exact permission/approved-once context instead of requiring the capability to exist in the baseline lease.
- [ ] Update `aevra_status` from `PermissionEngine.summary`.
- [ ] Run focused MCP and operation tests and verify GREEN.
- [ ] Commit with `feat: enforce exact connector capability approvals`.

### Task 3: Persist approval scopes as exact ordinary permission rules

**Files:**
- Modify: `apps/core/src/admin/routes/api.ts`
- Modify: `apps/core/src/approvals/approval-service.ts`
- Modify: `apps/core/test/admin-api.integration.test.ts` if present, otherwise create `apps/core/test/exact-capability-approval.integration.test.ts`

**Interfaces:**
- Approval decisions `session`, `workspace`, and `global` persist the ticket's exact `capability` + matcher with actor/session/workspace boundaries.
- `once` persists nothing and only resumes the frozen operation.
- CRITICAL requests never create persistent rules.

- [ ] Write failing tests proving session/workspace/global approval create one exact rule and `files.write` approval never writes unrelated capabilities.
- [ ] Run focused tests and verify RED.
- [ ] Update admin approval route persistence and remove the special broad capability-upgrade restriction/path that is no longer used.
- [ ] Run focused tests and verify GREEN.
- [ ] Commit with `feat: persist exact approval scopes`.

### Task 4: Atomic bulk matcher expansion

**Files:**
- Modify: `apps/core/src/admin/bulk-actions.ts`
- Modify: `apps/core/test/admin-bulk-actions.integration.test.ts`

**Interfaces:**
- `POST /api/permissions/bulk` accepts `commandMatchers?:string[]` while retaining legacy `matcher?:string` compatibility.
- Non-command capabilities always expand with matcher `*` unless legacy single-capability behavior requires the legacy matcher.
- `commands.run` expands once per trimmed/deduplicated command matcher.
- Entire expansion validates before `PermissionRepository.upsertMany`.

- [ ] Write failing tests for `files.read + files.write + commands.run` expansion, matcher trimming/deduplication, empty command matcher rejection, `*` support, critical-pattern rejection per matcher, deterministic duplicate removal, and zero writes on any invalid request.
- [ ] Run focused bulk tests and verify RED.
- [ ] Build the complete rule expansion in memory, validate all targets/matchers/critical restrictions, deduplicate by effect+capability+scope+target+actor+matcher, then persist with `upsertMany`.
- [ ] Run focused tests and verify GREEN.
- [ ] Commit with `feat: support batch command permission matchers`.

### Task 5: Configured connector inventory including offline OAuth clients

**Files:**
- Modify: `packages/store/src/oauth.ts`
- Modify: `apps/core/src/auth/oauth.ts`
- Modify: `apps/core/src/admin/routes/api.ts`
- Modify: relevant OAuth/admin tests

**Interfaces:**
- `OAuthRepository.listClients():OAuthClientRecord[]`
- `AevraOAuthService.listClients()` returns configured client metadata including backend-resolved `actor` such as `oauth:${clientName}`.
- `GET /api/oauth/clients` exposes configured OAuth connector identities for the admin UI.

- [ ] Write failing repository/API tests for listing OAuth clients before they have an active session.
- [ ] Run focused tests and verify RED.
- [ ] Add repository/service/API list support with backend-provided actor strings.
- [ ] Run focused tests and verify GREEN.
- [ ] Commit with `feat: expose configured oauth connector inventory`.

### Task 6: Permissions modal connector targeting and command matcher editor

**Files:**
- Modify: `apps/web/admin-enhancements.js`
- Modify: `apps/web/admin-enhancements.css`
- Modify: `scripts/test/web-admin-enhancements.test.mjs`

**Interfaces:**
- Permissions page fetches `/api/oauth/clients` in addition to existing connector/session endpoints.
- `Selected connectors` list combines configured static connectors and configured OAuth clients regardless of activity, with `Connected`, `Configured`, or `Never used` status metadata.
- Session target panel continues to list only live sessions.
- When `commands.run` is selected, show multiline `Command matchers` textarea, trim/dedupe lines, require >=1, warn on `*`, and POST `commandMatchers`.
- Footer count uses connector × target × expanded capability/matcher count.

- [ ] Extend static web regression tests to require offline connector inventory, new label copy, command matcher textarea, `*` warning, command-only matcher payload, and correct count formula.
- [ ] Run the web test and verify RED.
- [ ] Implement connector inventory/status mapping and matcher editor behavior without adding a second permissions renderer.
- [ ] Run `node --check apps/web/admin-enhancements.js` and the focused web test; verify GREEN.
- [ ] Commit with `feat: improve bulk connector permission targeting`.

### Task 7: Platform safe-command matcher Guide

**Files:**
- Create: `apps/web/safe-command-matchers.js`
- Modify: `apps/web/index.html`
- Modify: `apps/web/app.js`
- Modify: `apps/core/src/admin/routes/api.ts` guide chapter list
- Create: `manual/16-safe-command-matchers.md`
- Modify: `package.json`
- Modify: `scripts/test/web-admin-shell.test.mjs` or create `scripts/test/safe-command-guide.test.mjs`

**Interfaces:**
- `window.AevraSafeCommandMatchers` is the single conservative browser catalog consumed by Guide rendering and source-level tests.
- Catalog entries contain `matcher`, `example`, `purpose`, `platforms`, and `riskNote`.
- Guide slug `safe-command-matchers` renders Windows/Linux/macOS tabs and Copy controls from that catalog.
- Recommended catalog excludes `shell:powershell`, `shell:bash`, and `shell:sh`.

- [ ] Write failing guide tests requiring all three platform tabs, shared catalog loading, known safe families, and exclusion of broad shell families.
- [ ] Run focused guide tests and verify RED.
- [ ] Add the catalog, script include/build syntax check, guide chapter, tab renderer, copy actions, and explanatory markdown warning that recommendations are not a security guarantee.
- [ ] Run `node --check` for affected web scripts and guide tests; verify GREEN.
- [ ] Commit with `docs: add platform safe command matcher guide`.

### Task 8: Single contextual bottom-right toast stack

**Files:**
- Modify: `apps/web/ui-runtime.js`
- Modify: `apps/web/app.css`
- Modify: `apps/web/admin-enhancements.js`
- Modify: `apps/web/admin-enhancements.css`
- Modify: `apps/core/src/admin/routes/api.ts`
- Modify: web regression tests

**Interfaces:**
- Permission DELETE response includes removed rule actor context, using `PermissionRepository.get` before delete.
- Runtime mutation toast detects permission DELETE and emits `Permission removed from {actorLabel}`.
- Enhancement-local toast function/host and its CSS are deleted.
- `.toast-stack` uses `bottom` + `right`; appended newest toast sits nearest the bottom and older toasts extend upward.

- [ ] Write failing web/API tests for contextual permission removal, one toast implementation, bottom-right stack, and no `.enh-toast-host`/duplicate `Permission revoked` emission.
- [ ] Run focused tests and verify RED.
- [ ] Return removed permission metadata from DELETE, remove local enhancement toast code/calls, and teach global runtime toast to parse the permission deletion response.
- [ ] Move global toast stack to bottom-right with upward growth.
- [ ] Run syntax and web/API tests; verify GREEN.
- [ ] Commit with `fix: unify contextual permission notifications`.

### Task 9: Regression verification and dead-code cleanup

**Files:**
- Modify only files proven dead by the preceding changes, especially old capability-upgrade helpers/tests/copy.
- Update this plan checkboxes/status notes after verification.

**Interfaces:** None new.

- [ ] Search for `workspace:capability-upgrade`, `profileForCapability`, enhancement-local `toast(`, `Selected connected connectors`, and old single `matcher` assumptions; remove only unreachable/dead remnants while retaining backward-compatible API handling where specified.
- [ ] Run targeted suites: policy tests, MCP tool tests, admin bulk/API tests, OAuth tests, and web tests.
- [ ] Run `npm run build` if the environment can execute the repository; otherwise record the exact verification limitation and do not claim a full build pass.
- [ ] Inspect final `main` commit and changed files for accidental branch/CI changes.
- [ ] Commit any cleanup with `chore: remove obsolete permission upgrade code`.
