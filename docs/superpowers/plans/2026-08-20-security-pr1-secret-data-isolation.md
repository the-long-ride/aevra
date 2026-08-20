# PR1 Secret & Data Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the central security guard resource boundary and close secret/search/environment/persistence/read-size/host-path leaks.

**Architecture:** Core `SecurityGuard` decides immutable remote resource policy before capability/YOLO policy. Worker independently classifies filesystem search targets, performs bounded reads, and constructs child environments from an allowlist rather than ambient daemon environment.

**Tech Stack:** TypeScript, Node.js, SQLite, Node test runner, existing MCP/Worker IPC and security packages.

**Spec:** `docs/superpowers/specs/2026-08-20-security-hardening-central-guard-design.md`

## Global Constraints

- Preserve normal MCP tool names and normal-file behavior.
- SECRET remote reads/search/mutations are always denied, including YOLO.
- SENSITIVE reads/searches are masked; mutations require one-time local approval, including YOLO.
- Inline env values are memory-only and must not reach persistent storage/audit/diagnostics.
- Partial reads must not load or transfer the entire file.
- Remote process results must not expose absolute host paths.

---

### Task 1: Central SecurityGuard resource decision

**Files:**
- Create: `apps/core/src/security/security-guard.ts`
- Test: `apps/core/test/security-guard.unit.test.ts`
- Modify: `packages/mcp-tools/src/service-types.ts`
- Modify: `apps/core/src/runtime.ts`

**Interfaces:**
- Produces `SecurityGuard.authorizeResource(input)`.
- Input includes `sessionId`, `capability`, `operation`, `logicalPath`, and `mutation`.
- Output includes `sensitivity` and `decision: 'allow' | 'approval-required' | 'deny'`.

- [ ] **Step 1: Write failing guard tests**

Cover:
```ts
assert.equal(guard.authorizeResource(secretRead).decision, 'deny');
assert.equal(guard.authorizeResource(secretWriteInYolo).decision, 'deny');
assert.equal(guard.authorizeResource(sensitiveRead).decision, 'allow');
assert.equal(guard.authorizeResource(sensitiveWriteInYolo).decision, 'approval-required');
```

- [ ] **Step 2: Run RED**

Run: `node scripts/test.mjs unit`

Expected: guard test fails because module/API does not exist.

- [ ] **Step 3: Implement minimal guard**

Use existing `classifySensitivity()` and session/workspace services. Do not duplicate ordinary capability policy here. Return immutable resource restrictions only.

- [ ] **Step 4: Inject guard into MCP dependencies**

Add `security?: SecurityGuard` to `McpToolDependencies`; construct one in `createCoreRuntime`.

- [ ] **Step 5: Run GREEN**

Run focused guard unit test plus `npm run typecheck`.

---

### Task 2: File read/search sensitivity enforcement

**Files:**
- Modify: `packages/mcp-tools/src/file-tools.ts`
- Modify: `packages/executor/src/files.ts`
- Modify: `packages/security/src/sensitive.ts`
- Modify: `packages/protocol/src/worker.ts`
- Test: new `packages/mcp-tools/test/file-sensitivity.security.test.ts`
- Test: `packages/executor/test/files.contract.test.ts`

**Interfaces:**
- Add `maskSensitiveFile(path, content)`.
- Extend Worker `file.read` operation with optional `offset` and `length`.
- Worker ranged read returns `{path, hash, content, offset, length, totalLength}`.

- [ ] **Step 1: Write failing secret-search regression**

Create `.env` containing a unique marker and assert `file_search` never returns the marker or a hit from that file under read-only and YOLO sessions.

- [ ] **Step 2: Write failing SENSITIVE masking regressions**

Create `.npmrc`/credential-like fixture and assert read/search output preserves safe structure but not raw value.

- [ ] **Step 3: Write failing ranged-read regression**

Use a multi-megabyte test file and instrument/read only a requested range; assert returned length matches requested chunk and `totalLength` reports full size.

- [ ] **Step 4: Run RED focused tests**

Expected failures: secret search leaks, sensitive read unmasked, Worker lacks range operation.

- [ ] **Step 5: Implement masking helpers and Worker-side filtering**

In `fileSearch`, classify each candidate path before opening it. SECRET => skip. SENSITIVE => mask matching lines before return. Do not return a placeholder hit for SECRET files.

- [ ] **Step 6: Implement Worker-side range reads**

Use `open`/`stat`/bounded `read` for ranged calls. Keep full reads compatible but reject pathological full reads above a high explicit maximum with an error directing caller to `offset/length`.

- [ ] **Step 7: Route MCP reads through SecurityGuard**

Guard target path before worker dispatch. SECRET => `CAPABILITY_REQUIRED`/security denial. SENSITIVE mutation path must not fall into ordinary YOLO fast path.

- [ ] **Step 8: Run GREEN**

Run file sensitivity tests, executor file tests, MCP exact capability tests, and typecheck.

---

### Task 3: SENSITIVE mutation one-time approval

**Files:**
- Modify: `packages/mcp-tools/src/file-tools.ts`
- Modify: `packages/mcp-tools/src/authorization.ts`
- Test: new `packages/mcp-tools/test/sensitive-mutation-approval.security.test.ts`

**Interfaces:**
- SecurityGuard can force `approval-required` with `scope: 'once'` independently of YOLO/persistent permission outcome.

- [ ] **Step 1: Write failing tests**

Prove `.npmrc` write/delete/patch under YOLO still returns an approval request, and approving once permits only the frozen operation.

- [ ] **Step 2: Run RED**

Expected: YOLO executes immediately today.

- [ ] **Step 3: Add immutable-security approval path**

Evaluate guard before the YOLO return in file mutation handlers. Mark the resulting ticket so persistent approval scopes are rejected.

- [ ] **Step 4: Run GREEN**

Run sensitive mutation and YOLO suites.

---

### Task 4: Minimal child environment

**Files:**
- Create: `packages/executor/src/environment.ts`
- Modify: `packages/executor/src/commands.ts`
- Modify: `packages/executor/src/processes.ts`
- Modify: `apps/worker/src/process-host.ts`
- Modify: `packages/executor/src/docker.ts`
- Test: new `packages/executor/test/environment.security.test.ts`
- Test: `packages/executor/test/commands.contract.test.ts`
- Test: `packages/executor/test/processes.contract.test.ts`

**Interfaces:**
- Produces `safeBaseEnvironment(platform, sourceEnv)` and `buildChildEnvironment(explicitEnv)`.
- Allow platform execution essentials only: PATH plus required OS/temp/home locale variables; never arbitrary inherited secrets.

- [ ] **Step 1: Write failing inherited-secret test**

Set a fake `AEVRA_TEST_PARENT_SECRET` in parent process, execute a child that prints it, and assert the child does not receive it unless explicitly supplied.

- [ ] **Step 2: Write explicit-env compatibility test**

Assert explicitly supplied env values remain available to the child and are redacted from returned output when echoed.

- [ ] **Step 3: Run RED**

Expected: parent secret is inherited today.

- [ ] **Step 4: Implement allowlisted environment builder**

Replace `{...process.env, ...input.env}` on host command/process child paths. Docker CLI invocation may retain daemon execution essentials but container env receives only explicit variables.

- [ ] **Step 5: Run GREEN**

Run environment, command and process suites on supported platforms.

---

### Task 5: Memory-only inline env persistence

**Files:**
- Modify: `apps/core/src/approvals/approval-service.ts`
- Modify: `packages/store/src/approvals.ts`
- Modify: `packages/store/src/processes.ts`
- Modify: `apps/core/src/processes/process-service.ts`
- Modify: `packages/mcp-tools/src/command-tools.ts`
- Modify: `packages/mcp-tools/src/process-change-tools.ts`
- Test: new `apps/core/test/volatile-approval-payload.security.test.ts`
- Test: new `packages/store/test/process-env-persistence.security.test.ts`

**Interfaces:**
- ApprovalService maintains volatile frozen payload values keyed by approval id for the current runtime.
- Repository stores a sanitized payload descriptor, replacing env values with names/refs only.
- Process records persist command executable/args plus env names/ref metadata, never raw env values.

- [ ] **Step 1: Write failing SQLite leak tests**

Insert command/process requests with unique secret values and query raw SQLite rows; assert secret text currently appears and therefore tests fail.

- [ ] **Step 2: Implement payload sanitizer + volatile payload map**

Persist sanitized descriptor; on approved resume hydrate from volatile payload. Restart already cancels pending approvals, so no cross-restart raw value recovery is required.

- [ ] **Step 3: Sanitize process persistence**

Keep raw command env only in Worker/runtime memory. Store env variable names or explicit secret refs in process metadata.

- [ ] **Step 4: Run GREEN**

Run approval/process/store/security suites.

---

### Task 6: Remote-safe process projection

**Files:**
- Modify: `apps/core/src/processes/process-service.ts`
- Test: new `apps/core/test/process-remote-projection.security.test.ts`

**Interfaces:**
- `remoteRecord`/remote start/status/list/log results never contain `logPath`, `resultPath`, or absolute host paths.
- Local-admin `listLocal()` retains operational path metadata.

- [ ] **Step 1: Write failing remote leak tests**
- [ ] **Step 2: Implement explicit remote projection**
- [ ] **Step 3: Run process tests and typecheck**

---

### Task 7: PR1 full verification

- [ ] Run `npm run format:check`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run test:coverage`.
- [ ] Run `npm run build`.
- [ ] Re-run the exploit tests with YOLO enabled.
- [ ] Review diff for raw secret literals, `...process.env` child construction, host path exposure, or SECRET bypasses.

Expected: all gates pass and no confirmed PR1 finding remains reproducible.
