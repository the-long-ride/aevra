# Durable MCP Processes, Typed Tools, Skill Permissions, and Switch Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Aevra long-running commands reconnect-safe and provable, improve MCP contracts, add dedicated skill/instruction read-write permissions/tools, and migrate binary UI controls to a shared OpenCode-style switch.

**Architecture:** Managed processes remain the durable compatibility layer rather than holding one MCP HTTP request open. Worker/runtime owns live child observation; Core owns canonical process records and reconciles status into SQLite. Skills/instructions get purpose-specific capabilities and tools with path-bounded service methods. React gets one shared semantic switch component used everywhere binary choices are rendered.

**Tech Stack:** Node.js 22+, TypeScript, node:test, SQLite, React, Vitest, MCP tool registry, Aevra Core/Worker IPC.

**Spec:** `docs/superpowers/specs/2026-08-20-mcp-long-running-processes-permissions-switches-design.md`

## Global Constraints

- `command_run` remains synchronous and bounded; long-running work uses managed processes.
- Do not depend on experimental MCP Tasks support.
- Keep compatibility with ChatGPT, Claude, and clients that only understand ordinary MCP tools.
- Existing permission rules and process rows remain readable.
- Skill/instruction writes are purpose-bounded and do not grant arbitrary workspace file writes.
- Keep Aevra's Core/Worker split: Worker executes; Core owns canonical metadata.
- Use TDD: every behavior change gets a failing test before production code.
- UI stays flat, monospaced, 4px interactive radius, no gradients/shadows.

---

### Task 1: Durable managed-process terminal state

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/worker.ts`
- Modify: `packages/executor/src/processes.ts`
- Modify: `apps/worker/src/process-host.ts`
- Modify: `apps/worker/src/dispatcher.ts`
- Modify: `packages/store/src/migrations.ts`
- Modify: `packages/store/src/processes.ts`
- Modify: `apps/core/src/processes/process-service.ts`
- Test: `packages/executor/test/processes.contract.test.ts`
- Test: `apps/worker/test/process-host.integration.test.ts`
- Test: `apps/core/test/worker-manager.integration.test.ts` or a focused new process-service test if required

**Interfaces:**
- Produces `ManagedProcessState = 'running' | 'completed' | 'failed' | 'stopped' | 'unknown'`.
- Produces `ManagedProcessStatus` with `processId`, `pid`, `state`, `exitCode`, `signal`, `startedAt`, `finishedAt`, `durationMs`, `lifecycle`.
- Produces worker operations `process.status` and `process.wait`.
- `process.wait` accepts `timeoutMs`, clamps to a safe bounded interval, and returns the current status on timeout rather than failing.

- [ ] **Step 1: Write failing executor tests**

Add tests proving a short-lived attached child transitions from `running` to `completed`, exposes exit code `0`, finish time, duration, and terminal log EOF; add a non-zero child test that exposes `failed` with its exit code.

- [ ] **Step 2: Run the focused executor test and confirm RED**

Run: `npm run test:contract -- packages/executor/test/processes.contract.test.ts`
Expected: FAIL because status/wait/terminal fields do not exist.

- [ ] **Step 3: Implement attached-process status/wait**

Track child `exit`/`close` in `ManagedProcessRuntime`; preserve terminal fields in each entry; add `status(id)` and async `wait(id, timeoutMs)`; make `list()` and `logs()` include terminal state and EOF.

- [ ] **Step 4: Add failing keep-running sidecar test**

Start a detached process that exits `7`; assert a result sidecar appears and runtime status reports `failed`, exit code `7`, and finish time after the helper exits.

- [ ] **Step 5: Run keep-running test and confirm RED**

Run: `npm run test:integration -- apps/worker/test/process-host.integration.test.ts`
Expected: FAIL because no result sidecar is written/read.

- [ ] **Step 6: Implement keep-running result sidecar**

Pass `AEVRA_PROCESS_RESULT` to process-host; write result JSON atomically on child exit; read sidecar from executor status/list/logs.

- [ ] **Step 7: Add protocol/dispatcher support**

Add `process.status` and `process.wait` worker operations and dispatch them to runtime.

- [ ] **Step 8: Add migration and repository reconciliation tests**

Add migration 6 columns: `state`, `exit_code`, `signal`, `finished_at`, `failure_message`; test old rows default safely to `unknown`/null and repository status updates do not replace command/ownership fields.

- [ ] **Step 9: Implement Core reconciliation**

`ProcessService.list/status/logs/wait` observes worker status and persists terminal fields. Existing Core restart semantics remain unchanged; uncertain re-adoption stays explicit.

- [ ] **Step 10: Run process-focused tests GREEN**

Run contract/integration tests for executor, worker, store, and Core process service. Expected: PASS.

### Task 2: MCP process tools and typed tool contracts

**Files:**
- Modify: `packages/mcp-tools/src/process-change-tools.ts`
- Modify: `packages/mcp-tools/src/registry.ts`
- Modify: `packages/mcp-tools/src/register.ts`
- Modify: `packages/mcp-tools/src/service-types.ts`
- Test: `packages/mcp-tools/test/registry.unit.test.ts`
- Test: `packages/mcp-tools/test/register.structured-content.contract.test.ts`
- Test: `packages/mcp-tools/test/service.integration.test.ts`

**Interfaces:**
- Adds MCP tools `process_status` and `process_wait`.
- `process_wait` input: `{ processId: string, timeoutMs?: integer }`.
- Process outputs use one explicit status schema shared across start/list/status/wait/logs where practical.
- Tool descriptors add optional `outputSchema`.

- [ ] **Step 1: Write failing registry tests**

Assert `process_status` and `process_wait` exist, all process tools use closed input schemas, and process tools publish output schemas with `state`, `exitCode`, and timestamps.

- [ ] **Step 2: Run registry test RED**

Run: `npm run test:unit -- packages/mcp-tools/test/registry.unit.test.ts`
Expected: FAIL because the tools/output schemas are missing.

- [ ] **Step 3: Implement tool definitions**

Add names, exact schemas, descriptions, and correct annotations. `process_status`, `process_wait`, `process_list`, and `process_logs` are read-only/idempotent; start/restart/stop are not.

- [ ] **Step 4: Write failing dispatch tests**

Assert `process_status` calls ProcessService status and `process_wait` calls ProcessService wait with a bounded timeout.

- [ ] **Step 5: Implement handlers and service types**

Extend `PROCESS_CHANGE_TOOL_NAMES` and route the two tools.

- [ ] **Step 6: Write failing structured-content tests**

Assert tools with `outputSchema` return matching `structuredContent` while retaining existing MCP content compatibility.

- [ ] **Step 7: Implement structured output bridge**

Update registration/response normalization once, not per tool.

- [ ] **Step 8: Run MCP tool tests GREEN**

Run registry, structured-content contract, and service integration tests. Expected: PASS.

### Task 3: Dedicated skill/instruction capabilities and write tools

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `apps/core/src/policy/capabilities.ts`
- Modify: `apps/core/src/policy/permissions.ts`
- Modify: `apps/core/src/skills/skills-service.ts`
- Modify: `packages/mcp-tools/src/basic-tools.ts`
- Modify: `packages/mcp-tools/src/skill-access-gate.ts`
- Modify: `packages/mcp-tools/src/registry.ts`
- Test: `apps/core/test/permissions.unit.test.ts`
- Test: `apps/core/test/skills-service.unit.test.ts`
- Test: `packages/mcp-tools/test/skill-access-gate.integration.test.ts`
- Test: `apps/core/test/skills-tools.security.test.ts`
- Test: `apps/core/test/skills-tools.contract.test.ts`

**Interfaces:**
- Adds capabilities `skills.read`, `skills.write`, `instructions.read`, `instructions.write`.
- Adds `skill_write({source,name,file?,content})`.
- Adds `instructions_write({source,content})` where source is `user | workspace`.

- [ ] **Step 1: Write failing capability/permission tests**

Assert the four new capabilities participate in ordering/effective summaries and built-in profiles/YOLO grant expected access without conflating them with `files.read` or `files.write`.

- [ ] **Step 2: Run permission tests RED**

Run: `npm run test:unit -- apps/core/test/permissions.unit.test.ts`
Expected: FAIL because new capabilities are absent.

- [ ] **Step 3: Implement protocol capability model**

Add the four capabilities to `Capability`, `ALL_CAPABILITIES`, capability ordering, and appropriate built-in profiles. Read-only gets skill/instruction read; coding/developer/full get read; full-workspace also gets write. YOLO continues to derive from all capabilities.

- [ ] **Step 4: Write failing SkillsService write tests**

Test workspace skill write, user skill write, instruction write, nested relative file write, path escape rejection, absolute path rejection, and file-cap enforcement.

- [ ] **Step 5: Run SkillsService tests RED**

Run: `npm run test:unit -- apps/core/test/skills-service.unit.test.ts`
Expected: FAIL because write methods do not exist.

- [ ] **Step 6: Implement bounded writes**

Add UTF-8 write helpers that create parent directories only inside the approved skill package/dedicated instruction path. Resolve/contain paths before writing. Do not expose arbitrary roots.

- [ ] **Step 7: Write failing MCP access tests**

Assert read tools require read capabilities and write tools require separate write capabilities. A `files.write` rule alone must not authorize `skill_write` or `instructions_write`.

- [ ] **Step 8: Implement tool handlers and approval gating**

Replace the old generic `files.read` skill gate with capability-aware gating. Add `skill_write` and `instructions_write` to the basic tool handler and registry with exact schemas/output schemas.

- [ ] **Step 9: Run skill/instruction contract + security tests GREEN**

Run focused Core and MCP tool suites. Expected: PASS.

### Task 4: Shared OpenCode-style Switch and checkbox migration

**Files:**
- Create: `apps/web-react/src/components/Switch.tsx`
- Create: `apps/web-react/src/components/Switch.test.tsx`
- Modify: `apps/web-react/src/features/permissions/PermissionsPage.tsx`
- Modify: any additional `apps/web-react/src/**/*.tsx` files containing user-visible binary checkboxes
- Modify: `apps/web-react/src/styles/components.css`
- Test: existing React feature tests touching migrated controls

**Interfaces:**
- `SwitchProps` extends checkbox input semantics for `name`, `value`, `checked/defaultChecked`, `disabled`, `onChange`, and accessible label text.
- Component renders a native checkbox plus styled switch track/thumb and sets `role="switch"`/`aria-checked`.

- [ ] **Step 1: Write failing Switch tests**

Test off/on rendering, click/change behavior, `name/value` FormData compatibility, keyboard-accessible native input, disabled state, and role/checked semantics.

- [ ] **Step 2: Run Switch test RED**

Run: `npm --prefix apps/web-react test -- Switch.test.tsx`
Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement minimal Switch**

Use a real checkbox input visually hidden only after preserving focus semantics; style sibling track/thumb with Aevra tokens, 4px radius, no shadow/gradient.

- [ ] **Step 4: Add failing PermissionsPage test**

Assert the capability form exposes switch roles for every capability including `skills.read`, `skills.write`, `instructions.read`, and `instructions.write`, and command matcher visibility still follows `commands.run`.

- [ ] **Step 5: Migrate PermissionsPage and remaining binary checkboxes**

Replace native visible checkboxes with `Switch` while retaining form names/values and existing state handlers.

- [ ] **Step 6: Run web tests GREEN**

Run `npm run test:web`. Expected: PASS.

### Task 5: Documentation, full verification, and branch completion

**Files:**
- Modify: `docs/specs/03-mcp-protocol.md`
- Modify: `docs/specs/05-skills-instructions.md`
- Modify: `docs/specs/06-workspaces-execution.md`
- Modify: `docs/user-manual/08-permissions-approvals.md`
- Modify: `docs/user-manual/09-skills.md`
- Modify: `docs/user-manual/11-processes.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update docs**

Document process start/status/wait/log flow, final exit-code proof, new capabilities/tools, and switch-based permission UI.

- [ ] **Step 2: Run formatting and static checks**

Run: `npm run format:check && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run full tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Run coverage and build**

Run: `npm run test:coverage && npm run build`
Expected: PASS.

- [ ] **Step 5: Review branch diff**

Run: `git diff main...HEAD --check` and inspect changed files for unintended capability broadening, path escapes, or raw checkbox remnants.

- [ ] **Step 6: Push/complete branch**

Push the verified feature branch. If GitHub Actions creates a superseded run for an earlier pushed commit, cancel the old run and keep only the newest verification run active.
