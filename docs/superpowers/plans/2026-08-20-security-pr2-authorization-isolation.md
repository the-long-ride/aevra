# PR2 Authorization & Session Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make identity ownership explicit for privileged ID-addressed operations, fix host process step-up, and prove YOLO revocation restores ordinary policy without ending the session.

**Architecture:** Extend the central `SecurityGuard` with ownership decisions keyed by `{actor, subject, workspaceId}`. Persist only the identity metadata needed for reconnect-safe ownership checks; local admin remains privileged and remote IDs alone never authorize actions.

**Tech Stack:** TypeScript, Node.js, SQLite migrations, MCP tool services, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-20-security-hardening-central-guard-design.md`

## Global Constraints

- Start this branch from the merged PR1 result.
- Fresh MCP sessions may resume state only when actor + subject + workspace match.
- Actor display name alone is not sufficient identity.
- `process_start` host execution must step up even when baseline `commands.run` exists.
- YOLO revocation must not disconnect or replace the session/lease.

---

### Task 1: Persist reconnect-safe ownership identity

**Files:**
- Modify: `packages/store/src/migrations.ts`
- Modify: `packages/store/src/approvals.ts`
- Modify: `packages/store/src/changes.ts`
- Modify: `packages/store/src/processes.ts`
- Modify: `apps/core/src/approvals/approval-service.ts`
- Modify: `apps/core/src/changes/change-service.ts`
- Modify: `apps/core/src/processes/process-service.ts`
- Test: store migration/repository tests

**Interfaces:**
- Approval/change/process ownership records expose `ownerActor`, `ownerSubject`, `workspaceId` where remote ownership is required.

- [ ] Write migration tests proving existing rows remain readable and new ownership columns are additive.
- [ ] Run RED against old schema.
- [ ] Add migration and repository mappings.
- [ ] Populate ownership from current `SessionManager` identity at creation time.
- [ ] Run repository/migration tests GREEN.

---

### Task 2: SecurityGuard ownership decisions

**Files:**
- Modify: `apps/core/src/security/security-guard.ts`
- Test: `apps/core/test/security-guard.unit.test.ts`

**Interfaces:**
- Add `authorizeOwnedObject({sessionId, ownerActor, ownerSubject, workspaceId, action})`.
- Decision allows same tuple across a fresh MCP session but rejects actor-only/workspace-only matches.

- [ ] Add failing exact-match, mismatched-subject, mismatched-workspace, and mismatched-actor tests.
- [ ] Implement tuple comparison using session identity + active lease.
- [ ] Verify local-admin bypass is not exposed through remote MCP API.

---

### Task 3: Approval status/cancel ownership

**Files:**
- Modify: `packages/mcp-tools/src/basic-tools.ts`
- Modify: `apps/core/src/approvals/approval-service.ts`
- Modify: `packages/mcp-tools/src/approval-resume.ts`
- Test: new `packages/mcp-tools/test/approval-ownership.security.test.ts`

**Interfaces:**
- Add remote-aware `statusForSession(sessionId, requestId)` and `cancelForSession(...)` or equivalent guarded methods.
- Keep unrestricted `status()`/admin methods for localhost control plane only.

- [ ] Write exploit test: second subject possessing request id cannot inspect/cancel.
- [ ] Write reconnect test: same actor+subject+workspace on fresh session can inspect/resume where lifecycle permits.
- [ ] Route MCP approval tools through guarded methods.
- [ ] Run approval suites GREEN.

---

### Task 4: Change-set ownership

**Files:**
- Modify: `packages/mcp-tools/src/process-change-tools.ts`
- Modify: `apps/core/src/changes/change-service.ts`
- Test: new `packages/mcp-tools/test/change-ownership.security.test.ts`

**Interfaces:**
- `status`, `commit`, and `rollback` remote paths require current ownership tuple.
- Rollback executes only after caller ownership has been validated against the stored object.

- [ ] Write failing cross-session status/commit/rollback tests.
- [ ] Add guarded change methods accepting caller session id.
- [ ] Preserve local admin change actions through explicit local-only methods/context.
- [ ] Run recovery/change suites GREEN.

---

### Task 5: Process ownership and control

**Files:**
- Modify: `apps/core/src/processes/process-service.ts`
- Modify: `packages/mcp-tools/src/process-change-tools.ts`
- Test: new `packages/mcp-tools/test/process-ownership.security.test.ts`

**Interfaces:**
- Remote process status/wait/log/stop/restart require the stored owner tuple.
- Local admin remains capable of recovery actions.

- [ ] Add failing cross-identity process control test.
- [ ] Add same-tuple reconnect test.
- [ ] Guard remote process operations before Worker dispatch.
- [ ] Run process suites GREEN.

---

### Task 6: Host step-up for process_start

**Files:**
- Modify: `packages/mcp-tools/src/process-change-tools.ts`
- Reuse: command risk/host-fallback helpers from `command-tools.ts` or extract shared helper if required.
- Test: new `packages/mcp-tools/test/process-host-stepup.security.test.ts`

**Interfaces:**
- LOW process command on host is elevated to at least MEDIUM risk before authorization.

- [ ] Write failing test using a session whose baseline includes `commands.run`; `process_start` must still request host step-up unless a valid specific rule/once approval covers it.
- [ ] Implement shared host risk floor.
- [ ] Verify YOLO still permits normal host process execution after immutable PR1 resource checks.

---

### Task 7: YOLO revoke-without-interrupt invariant

**Files:**
- Modify if necessary: `apps/core/src/sessions/session-manager.ts`
- Test: `apps/core/test/session-yolo.unit.test.ts`
- Test: `apps/core/test/session-yolo.integration.test.ts`

- [ ] Assert enabling YOLO does not replace lease id.
- [ ] Assert disabling YOLO keeps session id and lease id unchanged.
- [ ] Assert post-disable effective capabilities revert immediately.
- [ ] Assert outstanding ordinary session state remains usable.

---

### Task 8: Audit authorization failures

**Files:**
- Modify: `apps/core/src/audit/audit-service.ts` callers / guarded services
- Test: ownership security tests

- [ ] Emit security-class audit events for denied cross-owner attempts without recording secrets/payloads.
- [ ] Include action, actor, session/workspace identifiers and generic denial reason only.

---

### Task 9: PR2 full verification

Run format check, lint, typecheck, full tests, security tests, coverage and build. Re-run all ownership exploits with leaked valid IDs. Confirm no remote operation authorizes solely from an object ID.
