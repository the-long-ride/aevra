# Privileged Hooks Middleware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add locally configured Aevra hooks that observe, block, or transform agent lifecycle payloads and can invoke external commands/applications without bypassing authorization or DLP.

**Architecture:** A central `HookEngine` owns matching, ordering, permissions, chain limits, and audit. A `HookRunner` owns bounded process execution. MCP/service/runtime components emit lifecycle events through this engine at explicit security boundaries; local admin APIs own persistence and Settings UI management.

**Tech Stack:** TypeScript, Node.js child_process/fs, existing SettingsRepository/AuditService/MCP activity log, React admin UI, node:test.

**Spec:** `docs/superpowers/specs/2026-08-22-search-hooks-middleware-design.md`

## Global Constraints

- Hook configuration is local-admin only; there are no remote MCP hook-management tools.
- Full middleware mode is enabled through explicit per-hook permissions.
- `before_tool_call` transformations occur before schema/path/capability/approval evaluation.
- `after_tool_call` and `before_response` transformations are followed by DLP/output security.
- Application hooks are observer-only.
- Hook processes are spawned without shell interpolation.
- Raw secrets are never persisted in hook audit records.

---

### Task 1: Hook domain model and validation

**Files:**
- Create: `apps/core/src/hooks/hook-types.ts`
- Create: `apps/core/src/hooks/hook-config.ts`
- Test: `apps/core/test/hook-config.unit.test.ts`

**Interfaces:**
- Produces: `HookEvent`, `HookPermission`, `HookDefinition`, `HookInvocation`, `HookAction`, and `validateHookDefinition(value)`.

- [ ] **Step 1: Add failing validation tests**

Cover all approved events, permission enum, timeout bounds, priority, global/workspace scope, filters, failure mode, unique ID/name requirements, and rejection of `application` hooks with `modify*` permissions.

- [ ] **Step 2: Run tests and confirm module is missing**
- [ ] **Step 3: Implement strongly typed domain model and validator**

The event union must include all events listed in the spec, including guaranteed `request_received` and best-effort `prompt_received`.

- [ ] **Step 4: Run tests and confirm pass**

### Task 2: Bounded command/application runner

**Files:**
- Create: `apps/core/src/hooks/hook-runner.ts`
- Test: `apps/core/test/hook-runner.unit.test.ts`

**Interfaces:**
- Produces: `HookRunner.run(definition, invocation): Promise<HookRunnerResult>` and `HookRunner.launch(definition, invocation): Promise<HookRunnerResult>`.

- [ ] **Step 1: Add failing runner tests with injected spawn/fs/temp dependencies**

Cover JSON stdin, temporary-file input, none input, application fire-and-forget, timeout kill, non-zero exit, malformed/multiple JSON output, stdout/stderr caps, payload cap, environment/secret reference resolution, and `shell: false`.

- [ ] **Step 2: Run tests and confirm failure**
- [ ] **Step 3: Implement runner with executable/argument arrays and bounded I/O**
- [ ] **Step 4: Run tests and confirm pass**

### Task 3: Hook engine, permissions, ordering, and audit

**Files:**
- Create: `apps/core/src/hooks/hook-engine.ts`
- Test: `apps/core/test/hook-engine.unit.test.ts`
- Modify: `apps/core/src/audit/audit-service.ts` only to accept structured redacted hook metadata if current fields are insufficient

**Interfaces:**
- Produces: `HookEngine.emit(event, context, payload, options?): Promise<HookEmissionResult>`.
- `HookEmissionResult` contains final payload, blocked state/reason, and invocation summaries.

- [ ] **Step 1: Add failing engine tests**

Cover priority then ID ordering, workspace/tool/connector filters, chained transformations, observe-only mutation rejection, event-specific mutation permissions, fail-open, fail-closed, explicit block, transformation count, chain depth, recursion marker, application observer behavior, and redacted audit hashes.

- [ ] **Step 2: Run tests and confirm failure**
- [ ] **Step 3: Implement engine and audit integration**

Hash original/final payloads with canonical JSON. Audit only redacted summaries and identifiers. Never expose identity/session mutations through `request_received`.

- [ ] **Step 4: Run tests and confirm pass**

### Task 4: Tool and response middleware integration

**Files:**
- Modify: `packages/mcp-tools/src/service.ts`
- Modify: `packages/mcp-tools/src/service-types.ts`
- Modify: `packages/mcp-tools/src/register.ts`
- Modify: `apps/core/src/mcp/modern-runtime.ts`
- Modify: `apps/core/src/mcp/server.ts`
- Test: `packages/mcp-tools/test/service.integration.test.ts` or nearest service test
- Test: `apps/core/test/mcp-modern.integration.test.ts`

**Interfaces:**
- Adds hook dependency methods usable by MCP service and ingress without importing core implementation details into the package layer.

- [ ] **Step 1: Add failing integration tests for transformed tool inputs**

Test `file_read -> shell_run` mutation and prove effective `shell_run` authorization is evaluated. Test path mutation to an escaped path and prove containment rejects it.

- [ ] **Step 2: Add failing output tests**

Test `after_tool_call` transformation and `before_response` transformation, followed by configured DLP/output guard invocation. Test `tool_call_blocked`, `tool_call_failed`, `response_finished`, and `response_failed` event emission.

- [ ] **Step 3: Implement event boundaries**

`McpToolService.call` emits `before_tool_call` before `callInner`; it then authorizes/executes the transformed name and arguments. It emits `after_tool_call` only on successful raw tool completion and failure/block events otherwise. Ingress emits `request_received`, response lifecycle events, and session lifecycle events using SessionManager's created/reused result.

- [ ] **Step 4: Run integration tests and confirm pass**

### Task 5: Approval, permission, process, workspace, connector, and gateway events

**Files:**
- Modify focused service/runtime files that own each state transition: approval service, process service, session/workspace transition path, connector admission/ingress, and core runtime lifecycle.
- Test each owner's existing unit/integration test file.

**Interfaces:**
- Emits approved lifecycle event names without duplicating events across layers.

- [ ] **Step 1: Add failing owner-level tests for each lifecycle event**

Verify exactly-once behavior for approval requested/granted/denied, permission denied, process started/finished/failed, workspace selected/changed, connector connected/disconnected, gateway started/stopping, session start/reconnect/end.

- [ ] **Step 2: Implement events at the state owner, not by inferring from unrelated activity logs**
- [ ] **Step 3: Run focused lifecycle tests and confirm pass**

### Task 6: Local admin hooks API

**Files:**
- Create: `apps/core/src/admin/routes/hook-routes.ts`
- Modify: `apps/core/src/admin/routes/api.ts`
- Modify: `apps/core/src/admin/routes/types.ts` if context typing requires it
- Modify: `apps/core/src/runtime.ts`
- Test: admin route integration tests

**Interfaces:**
- Provides `GET/POST /api/hooks`, `PATCH/DELETE /api/hooks/:id`, `POST /api/hooks/:id/test`, and `GET /api/hooks/:id/runs`.

- [ ] **Step 1: Add failing CRUD/API tests**

Verify validation errors, local-admin authentication inheritance, persistent settings writes, enable/disable, duplicate-safe IDs, synthetic test execution, bounded/redacted test diagnostics, and run history.

- [ ] **Step 2: Implement HookEngine construction in runtime and expose it through admin route context**
- [ ] **Step 3: Implement focused hook routes using `hooks.config` settings persistence**
- [ ] **Step 4: Run admin tests and confirm pass**

### Task 7: Settings Hooks UI

**Files:**
- Create: `apps/web-react/src/features/settings/HooksSettings.tsx`
- Modify: `apps/web-react/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web-react/src/features/settings/settings-service.ts`
- Modify: existing settings CSS only where needed
- Test: React settings tests

**Interfaces:**
- Loads hook list and supports add, edit, enable/disable, duplicate, test, view runs, and delete.

- [ ] **Step 1: Add failing UI tests for table, privileged badge, editor fields, and actions**
- [ ] **Step 2: Implement compact Hooks table/editor using existing DataTable/Dropdown patterns**
- [ ] **Step 3: Ensure mutation permissions visibly render `Privileged`**
- [ ] **Step 4: Run React tests/typecheck and confirm pass**

### Task 8: Full lifecycle and security regression verification

**Files:**
- Add or modify only tests needed for approved lifecycle/security cases.

**Interfaces:**
- Verifies complete hook event matrix and cross-boundary security behavior.

- [ ] **Step 1: Verify all approved events fire exactly once where applicable and prompt event absence when prompt data is unavailable**
- [ ] **Step 2: Verify transformed tool calls are re-authorized and escaped paths are denied**
- [ ] **Step 3: Verify DLP runs after tool-output and response transformations**
- [ ] **Step 4: Run format, lint, typecheck, full tests, coverage, and build on Linux and Windows CI**
- [ ] **Step 5: Remove temporary diagnostic workflows only after the final gate is green and then mark PR #10 ready**
