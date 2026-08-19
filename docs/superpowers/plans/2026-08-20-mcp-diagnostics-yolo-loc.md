# MCP Diagnostics, Session YOLO, and LOC Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add observable MCP client-host diagnostics, connector-session YOLO approval mode, and bring all currently flagged files under repository LOC/source-policy limits.

**Architecture:** Keep YOLO as an in-memory overlay owned by `SessionManager`; existing leases and connector bindings remain authoritative. MCP diagnostics are an in-memory recorder owned by `McpHttpServer` and surfaced only through localhost admin state. LOC cleanup uses responsibility-based extraction with compatibility re-exports where public module paths already exist.

**Tech Stack:** TypeScript, Node.js HTTP, React, SQLite repositories, Node test runner, repository source-policy scripts.

**Spec:** `docs/superpowers/specs/2026-08-20-mcp-diagnostics-yolo-loc-design.md`

## Global Constraints

- YOLO applies only to connector actors and only for the lifetime of the current Aevra session.
- YOLO bypasses Aevra capability/permission approval checks but not workspace containment, connector workspace binding, path policy, worker isolation, or DLP.
- YOLO state is never persisted to SQLite.
- Enabling/disabling YOLO must be auditable and locally controllable.
- MCP diagnostics must not claim to observe errors that never reached Aevra.
- All refactors are behavior-preserving except for the two requested features.
- Source LOC limits: TypeScript 350 lines, TSX 400 lines; no artificial source compression.

---

### Task 1: Session YOLO policy overlay

**Files:**
- Modify: `apps/core/src/policy/capabilities.ts`
- Modify: `apps/core/src/sessions/session-manager.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/mcp-tools/src/authorization.ts`
- Test: `apps/core/test/session-manager.unit.test.ts`
- Test: `packages/mcp-tools/test/exact-capability.integration.test.ts`

**Interfaces:**
- Produces: `ALL_CAPABILITIES: Capability[]`.
- Produces: `SessionManager.enableYolo(sessionId)`, `disableYolo(sessionId)`, `isYolo(sessionId)`.
- Produces: optional `Session.yolo` for admin/session presentation.

- [ ] **Step 1: Add failing session tests**

Add cases proving a connector session can enable YOLO, `getActiveLease()` exposes `ALL_CAPABILITIES`, disabling restores the persisted lease capabilities, non-connector actors are rejected, and revoke clears YOLO.

- [ ] **Step 2: Add the capability catalog and in-memory overlay**

Use one explicit capability catalog so “all” includes every protocol capability rather than only capabilities currently present in a profile. `getActiveLease()` overlays the catalog only while `isYolo(sessionId)` is true; do not overwrite the persisted lease.

- [ ] **Step 3: Bypass authorization only for YOLO sessions**

At the start of operation authorization, return without creating an approval when `sessions.isYolo(operation.sessionId)` is true. All downstream execution/path containment remains unchanged.

- [ ] **Step 4: Run focused tests**

Run the session manager and exact-capability tests. Expected: all pass.

### Task 2: Local admin and Requests drawer YOLO controls

**Files:**
- Modify: `apps/core/src/admin/routes/approval-permission-routes.ts`
- Modify: `apps/core/src/admin/routes/session-connector-routes.ts`
- Modify: `packages/admin-contracts/src/api-types.ts`
- Modify: `apps/web-react/src/features/requests/requests-service.ts`
- Modify: `apps/web-react/src/features/requests/RequestDrawer.tsx`
- Test: new `apps/core/test/session-yolo.integration.test.ts`
- Test: `apps/web-react/src/features/requests/requests.test.tsx`

**Interfaces:**
- Produces: `POST /api/approvals/:id/yolo` to enable YOLO for the ticket session and approve the current ticket.
- Produces: `DELETE /api/sessions/:id/yolo` to disable YOLO.
- Produces: `enableYoloApproval(id)` React service action.

- [ ] **Step 1: Add failing admin/API tests**

Create a connector session with a pending approval, call the YOLO approval endpoint, and assert the ticket becomes approved and session listing reports `yolo: true`. Disable through the session endpoint and assert `yolo: false`.

- [ ] **Step 2: Implement local admin routes**

Resolve the approval first, obtain its operation session ID, call `sessions.enableYolo`, then approve the current ticket with once scope. Reject missing/non-connector sessions with a 400 response. Add the disable route to session routes.

- [ ] **Step 3: Add Requests drawer danger action**

For pending operation approvals with a session ID, show `YOLO session`. Require a browser confirmation explaining that subsequent operations in this connector session skip capability/approval prompts. Call the combined endpoint and refresh the queue.

- [ ] **Step 4: Run focused admin and React tests**

Expected: new API tests and request drawer tests pass.

### Task 3: MCP diagnostic recorder and local observability

**Files:**
- Create: `apps/core/src/mcp/diagnostics.ts`
- Modify: `apps/core/src/mcp/server.ts`
- Modify: `apps/core/src/runtime.ts`
- Modify: `apps/core/src/admin/routes/session-connector-routes.ts`
- Modify: `packages/admin-contracts/src/api-types.ts`
- Modify: `apps/web-react/src/features/dashboard/DashboardPage.tsx` or its focused status child
- Test: new `apps/core/test/mcp-diagnostics.unit.test.ts`

**Interfaces:**
- Produces: `McpDiagnosticSnapshot` with listener state, counters, last traffic metadata, and derived hint.
- Produces: `McpHttpServer.diagnosticsSnapshot()`.
- Produces: `GET /api/diagnostics/mcp` localhost-admin response.

- [ ] **Step 1: Add failing diagnostic-state tests**

Verify transitions: listening/no requests => `no-client-traffic`; initialize seen/no tool calls => `initialized-no-tools`; tool call seen => `active`; closed => `stopped`.

- [ ] **Step 2: Implement recorder and server instrumentation**

Record only requests Aevra actually receives. Capture method before dispatch, actor/session after successful auth/session resolution, and tool name for `tools/call`.

- [ ] **Step 3: Surface diagnostics through localhost admin**

Pass a snapshot getter through runtime/admin route context and return it from `/api/diagnostics/mcp`. Also include the snapshot in runtime status if that status type already supports extension without duplication.

- [ ] **Step 4: Add compact Web UI state**

Display the derived hint. `no-client-traffic` copy must say the local server is listening but no MCP request has arrived and that a client/tool-host restriction is a likely external cause, not an Aevra auth/workspace denial.

### Task 4: Split MCP server and remove artificial compression

**Files:**
- Create: `apps/core/src/mcp/http-response.ts`
- Create: `apps/core/src/mcp/oauth-routes.ts`
- Modify: `apps/core/src/mcp/server.ts`

**Interfaces:**
- `handleOAuthRoute(...) => Promise<boolean>` owns OAuth metadata/register/authorize/token/revoke HTTP handling.
- HTTP response helpers own JSON/HTML/empty response boilerplate.

- [ ] **Step 1: Extract response and OAuth route helpers without changing response shapes/status codes**
- [ ] **Step 2: Rewrite remaining `server.ts` branches with one logical statement per line**
- [ ] **Step 3: Run MCP OAuth, ChatGPT compatibility, connector-path, and session tests**
- [ ] **Step 4: Run `npm run lint:loc` and verify `server.ts` is below 350 lines and has no compression violation**

### Task 5: Split file-mutation logic from OperationService

**Files:**
- Create: `apps/core/src/operations/file-mutations.ts`
- Modify: `apps/core/src/operations/operation-service.ts`
- Test: `apps/core/test/operation-service-execution.unit.test.ts`
- Test: existing recovery/change tests

**Interfaces:**
- Produces focused async helpers for create/write/delete/move/patch mutations that accept existing dependencies, inputs, and active lease.
- Existing `OperationService` public methods keep their signatures and delegate.

- [ ] **Step 1: Preserve mutation behavior in focused tests**
- [ ] **Step 2: Move mutation execution and unified-patch application to `file-mutations.ts`**
- [ ] **Step 3: Delegate from OperationService and keep command/read execution unchanged**
- [ ] **Step 4: Run operation, change, recovery, and LOC tests**

### Task 6: Split OAuth helper/store record responsibilities

**Files:**
- Create: `apps/core/src/auth/oauth-helpers.ts`
- Modify: `apps/core/src/auth/oauth.ts`
- Create: `packages/store/src/oauth-records.ts`
- Modify: `packages/store/src/oauth.ts`
- Test: `apps/core/test/oauth-service.unit.test.ts`
- Test: `packages/store/test/oauth.unit.test.ts`
- Test: `packages/store/test/oauth-client-inventory.unit.test.ts`

**Interfaces:**
- Core OAuth helper module owns PKCE/hash/string/redirect/scope validation utilities.
- Store record module owns OAuth repository record types and row mappers.
- `packages/store/src/oauth.ts` re-exports its existing public record types to preserve import compatibility.

- [ ] **Step 1: Extract helpers/types/mappers without altering behavior**
- [ ] **Step 2: Run OAuth service/store tests**
- [ ] **Step 3: Run LOC check for both flagged OAuth files**

### Task 7: Finish runtime, admin test, and SettingsPage LOC cleanup

**Files:**
- Create: `apps/core/src/runtime-types.ts`
- Modify: `apps/core/src/runtime.ts`
- Modify: `apps/core/test/admin-control-plane.integration.test.ts`
- Create or modify a focused settings helper under `apps/web-react/src/features/settings/`
- Modify: `apps/web-react/src/features/settings/SettingsPage.tsx`

**Interfaces:**
- Runtime public interfaces move to `runtime-types.ts` and are re-exported if existing consumers import them from `runtime.ts`.
- Settings helper extraction is presentational only.

- [ ] **Step 1: Move runtime types and one small composition helper until runtime is below 350 lines**
- [ ] **Step 2: Reduce the oversized admin test without multi-statement compression; split one test only if whitespace cleanup is insufficient**
- [ ] **Step 3: Extract a small SettingsPage presentational/helper unit so TSX remains below 400 lines**
- [ ] **Step 4: Run runtime/admin/settings tests and LOC check**

### Task 8: Full verification and branch review

- [ ] **Step 1: Run `npm run lint:loc`**
Expected: zero LOC/artificial-compression violations.

- [ ] **Step 2: Run `npm run typecheck`**
Expected: exit 0.

- [ ] **Step 3: Run `npm run lint`**
Expected: exit 0.

- [ ] **Step 4: Run `npm test`**
Expected: zero failed tests.

- [ ] **Step 5: Run the repository build command from `package.json`**
Expected: exit 0.

- [ ] **Step 6: Review branch diff against `main`**
Confirm no unrelated feature or configuration changes, no persisted YOLO elevation, and every `Remaining Work` item is resolved before claiming completion.
