# Worker MAC and Admin UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Core/Worker command envelope authentication and improve permission/session/workspace administration, command approvals, Guide usability, scrollbars, and Dashboard collapsibility.

**Architecture:** Keep the existing IPC, permission engine, approval service, shared `AevraDataTable`, Guide catalog, and dashboard layers. Fix MAC input at the canonicalization boundary so signatures match JSON transport, add a separate normalized command matcher used only for remembered `commands.run` permissions, and migrate the remaining admin tables to the shared data-table component. UI polish stays in the existing web files rather than adding another page owner.

**Tech Stack:** TypeScript, Node.js, HMAC-SHA256, JSON framed IPC, vanilla browser JavaScript/CSS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-18-worker-mac-admin-ux-design.md`

## Global Constraints

- Work directly on `main` only.
- Preserve HMAC authentication, replay protection, expiry checks, daemon-instance binding, and authenticated IPC handshake.
- Preserve exact-capability permission semantics; no profile-wide capability upgrade path.
- CRITICAL commands are one-time approval only.
- Persistent command approvals support session, workspace, and global scopes.
- Reuse `AevraDataTable` for admin tables.
- Do not add GitHub Actions workflows.

---

### Task 1: Make envelope MAC canonicalization JSON-stable

**Files:**
- Modify: `packages/ipc/src/envelope.ts`
- Test: `packages/ipc/test/envelope.unit.test.ts`
- Test: `packages/ipc/test/ipc.contract.test.ts`

**Interfaces:**
- Consumes: `HmacEnvelopeSigner.sign()` and `.verify()`.
- Produces: canonical HMAC input that is invariant across `JSON.stringify` / `JSON.parse` transport.

- [ ] **Step 1: Write the failing JSON-roundtrip regression**

Add a test that signs a command envelope containing nested undefined optional values, serializes/parses the envelope, and verifies it successfully. Also mutate the round-tripped command and assert MAC verification fails.

- [ ] **Step 2: Run the focused IPC test and verify RED**

Run: `npm test -- --run packages/ipc/test/envelope.unit.test.ts`

Expected: the round-trip verification fails with `invalid envelope mac` before the implementation.

- [ ] **Step 3: Implement JSON-compatible canonicalization**

Change the canonicalizer so object properties with `undefined` are omitted and array entries with `undefined` canonicalize as `null`. Preserve sorted object keys and all existing verification behavior.

- [ ] **Step 4: Run IPC tests and verify GREEN**

Run the envelope unit and IPC contract tests.

- [ ] **Step 5: Commit**

Commit message: `fix: stabilize worker envelope MAC across JSON`

---

### Task 2: Generate normalized remembered command matchers

**Files:**
- Create: `apps/core/src/policy/command-matcher.ts`
- Modify: `packages/mcp-tools/src/service.ts`
- Test: `apps/core/test/command-matcher.unit.test.ts`
- Adjust existing MCP service tests covering command approvals.

**Interfaces:**
- Produces: `commandPermissionMatcher(command: string[] | { executable:string; args:string[] }, options?:{shell?:string}): string`.
- `McpToolService.commandTool()` uses the returned matcher only for exact `commands.run` permission lookup/request persistence; risk/effect continues to use `classifyCommand()`.

- [ ] **Step 1: Write matcher RED tests**

Cover:

```text
git diff src/app.ts -> git:diff:*
dotnet test tests/Aevra.Tests.csproj --filter Category=Fast -> dotnet:test:*:--filter:*
npm test -- --runInBand -> npm:test:--:*
cargo test worker_manager -> cargo:test:*
```

Also cover shell normalization without persisting script text.

- [ ] **Step 2: Run the matcher unit test and verify RED**

Expected: module/function missing.

- [ ] **Step 3: Implement minimal matcher normalization**

Keep executable/subcommand and option names; wildcard positional arguments and option values; collapse duplicate wildcard tokens. For shell invocations return a broad shell matcher without script text.

- [ ] **Step 4: Wire matcher into `commandTool()` and `processStart()` where commands.run permission is requested**

Keep classification family separately for execution risk/effect. Use normalized matcher in `authorizeCapability(..., 'commands.run', ..., permissionMatcher, risk)` and approval payload.

- [ ] **Step 5: Run command/MCP tests and verify GREEN**

- [ ] **Step 6: Commit**

Commit message: `feat: remember normalized command permission matchers`

---

### Task 3: Expose all command approval scopes and persist exact matcher

**Files:**
- Modify: `apps/core/src/admin/approval-permissions.ts`
- Modify: `apps/core/src/admin/server/routes.ts`
- Modify: `apps/web/app-v2.js`
- Modify: `apps/web/app-v3.js` only if presentation decoration needs matcher preview support.
- Test: existing admin approval tests plus web request-drawer regression tests.

**Interfaces:**
- Non-CRITICAL commands: `once | session | workspace | global`.
- CRITICAL commands: `once` only; backend rejects persistent scopes even if crafted manually.
- Approval payload exposes the saved matcher for presentation.

- [ ] **Step 1: Add failing backend tests**

Assert session/workspace/global approvals persist `commands.run` using the normalized matcher. Assert a CRITICAL ticket approved with session/workspace/global does not produce a persistent rule and is rejected or coerced to once according to existing API error conventions.

- [ ] **Step 2: Add failing web regression**

Assert request cards for non-CRITICAL command tickets contain `Run once`, `Allow this session`, `Always in workspace`, and `Always globally`, and display `Saved matcher`. Assert CRITICAL cards omit the three persistent actions.

- [ ] **Step 3: Implement backend scope validation/persistence**

Keep `permissionRuleFromApproval()` exact. Enforce CRITICAL one-time-only in the approval route as defense in depth.

- [ ] **Step 4: Implement request-drawer actions/presentation**

Add global action and normalized matcher preview using server ticket payload/presentation. Keep exact-capability language.

- [ ] **Step 5: Run focused tests and verify GREEN**

- [ ] **Step 6: Commit**

Commit message: `feat: add scoped command approvals`

---

### Task 4: Migrate Permissions to `AevraDataTable`

**Files:**
- Modify: `apps/web/admin-enhancements.js`
- Test: `scripts/test/web-admin-enhancements.test.mjs`

**Interfaces:**
- Table id: `permissions-admin`.
- Filters: effect, capability, scope, actor.
- `onAction('revoke', row)` calls existing DELETE endpoint and refreshes.

- [ ] **Step 1: Write failing source/UI regression**

Assert `renderPermissions()` mounts `window.AevraDataTable`, includes the four filters and a search placeholder, and no longer uses the custom static `table()` helper for the main permission list.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement shared table**

Normalize rules into row objects containing display target/workspace/session labels. Use shared search/filter/sort/pagination. Preserve Add rules and revoke behavior.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

Commit message: `feat: add permission table search filters and pagination`

---

### Task 5: Migrate Workspaces and Sessions to `AevraDataTable`

**Files:**
- Modify: `apps/web/admin-enhancements.js`
- Test: `scripts/test/web-admin-enhancements.test.mjs`

**Interfaces:**
- Workspaces table id: `workspaces-admin`; filter key `mountState`.
- Remote sessions table id: `remote-sessions-admin`; filters `actor` and `workspaceState`.
- Local admin sessions table id: `local-sessions-admin`.

- [ ] **Step 1: Add failing regressions**

Assert each table mounts the shared component with requested search/filter/page behavior and actions remain wired.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement Workspaces table**

Rows expose name/root/description/mount count/mount state. Actions open Details or Remove.

- [ ] **Step 4: Implement Sessions tables**

Remote rows expose actor/session/workspace state/last activity and preserve Switch/Revoke actions. Local rows preserve Revoke. Keep `Revoke all others` toolbar action.

- [ ] **Step 5: Verify GREEN**

- [ ] **Step 6: Commit**

Commit message: `feat: add workspace and session table controls`

---

### Task 6: Add Safe command matcher Copy all

**Files:**
- Modify: `apps/web/app.js`
- Modify CSS used by Guide toolbar if needed.
- Test: Guide/web regression test.

**Interfaces:**
- `data-copy-all-matchers` copies current platform matcher strings joined with `\n`.

- [ ] **Step 1: Add failing Guide regression**

Assert Safe command matcher markup contains a top-right Copy all button and click handling joins only entries for `state.safePlatform`.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement Copy all**

Place it in the Guide section header beside platform tabs or a toolbar aligned right. Keep individual Copy buttons.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

Commit message: `feat: add copy all safe command matchers`

---

### Task 7: Apply thin transparent scrollbars

**Files:**
- Modify: `apps/web/styles.css` and/or the active v2/admin CSS files according to existing ownership.
- Test: web style regression.

**Interfaces:**
- Global scrollbar width/height 6px.
- Track and corner transparent.
- Firefox `scrollbar-width: thin` and transparent track color.

- [ ] **Step 1: Add failing CSS regression**

Assert global scrollbar selectors and Firefox properties exist.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement global scrollbar styling**

Use a subtle thumb with transparent track; do not add visible scrollbar backgrounds.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

Commit message: `style: simplify scrollbars`

---

### Task 8: Make Dashboard sections independently collapsible

**Files:**
- Modify: `apps/web/app-v2.js`
- Modify: `apps/web/app-v3.js`
- Modify dashboard CSS.
- Test: `scripts/test/web-dashboard-v2.test.mjs` and relevant v3 regression.

**Interfaces:**
- Every top-level dashboard section is `<details open class="dashboard-section ...">` with a summary/title.
- Remote Access stays separate from Onboarding.
- v3 may decorate/refresh section bodies but must not reparent Remote Access or force Onboarding closed.

- [ ] **Step 1: Add failing dashboard regression**

Assert all seven named top-level sections render as open details and v3 contains no `onboarding.open=false` or Remote Access reparenting behavior.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Refactor dashboard card helper/markup**

Use one consistent collapsible section helper for Runtime overview, Active connections, Tool activity, Connections, Recent activity, plus explicit Remote Access and Onboarding details. Default all open.

- [ ] **Step 4: Remove v3 auto-collapse/reparent code**

Keep guide buttons, runtime patching, active-connections insertion and polling intact.

- [ ] **Step 5: Verify GREEN**

- [ ] **Step 6: Commit**

Commit message: `feat: make dashboard sections collapsible`

---

### Task 9: Verification and stale-code sweep

**Files:**
- Adjust stale tests only where they encode intentionally replaced behavior.
- Do not add CI workflows.

- [ ] **Step 1: Search for stale behavior**

Search for old connected-only connector language, old command-family-only approval expectations, dashboard auto-collapse/reparent code, and custom main tables for Permissions/Workspaces/Sessions.

- [ ] **Step 2: Run focused tests**

Run IPC, policy/MCP, admin approval, web admin, Guide, and Dashboard tests.

- [ ] **Step 3: Run full verification when checkout permits**

```bash
npm test
npm run test:web
npm run build
```

- [ ] **Step 4: Review final main diff/state**

Confirm no `.github/workflows` file was introduced and all changes are on `main`.

- [ ] **Step 5: Final handoff**

Report exact verification evidence and explicitly identify any tests that could not be executed.