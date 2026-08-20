# PR4 Security Regression & Adjacent Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-audit adjacent privileged paths after PR1–PR3, convert security invariants into regression/property tests, and close any remaining HIGH/CRITICAL variants.

**Architecture:** Treat the central `SecurityGuard` and Worker containment/env enforcement as the expected choke points. Enumerate privileged entry points and prove each path either passes through those controls or is an explicitly local-admin-only boundary.

**Tech Stack:** TypeScript, Node tests, property-style test loops, existing security/DLP/path policy, Codex Security scan workflow where available.

**Spec:** `docs/superpowers/specs/2026-08-20-security-hardening-central-guard-design.md`

## Global Constraints

- Start from merged PR3.
- No speculative large rewrite without evidence.
- Compatibility-breaking fixes are allowed automatically only for newly validated HIGH/CRITICAL findings.
- Audit evidence and test fixtures must contain synthetic secrets only.

---

### Task 1: Privileged-path inventory

**Inspect:**
- MCP tool dispatch and approval resume;
- admin mutation routes;
- file/search/git/command/process Worker operations;
- recovery snapshot/restore;
- OAuth/token lifecycle;
- IPC envelope/client/server;
- config export/import preview;
- secrets/vault/platform store;
- skills/instructions;
- Cloudflare/tunnel configuration.

- [ ] Produce a repository-relative security boundary inventory in `docs/security/security-boundary-inventory.md`.
- [ ] For each privileged path mark: central guard, Worker enforcement, local-admin-only, or gap.
- [ ] Any gap gets a security test before a fix.

---

### Task 2: Filesystem containment property tests

**Files:**
- Extend: `packages/security/test/path-policy.security.test.ts`
- Add targeted executor tests where required.

- [ ] Generate path variants containing `..`, alternate separators, encoded-looking segments after decode, symlinks/junction-equivalent fixtures supported by platform, nested mounts, and nonexistent write targets.
- [ ] Assert no canonical path escapes the registered root.
- [ ] Add race-resistant checks where practical; document residual TOCTOU risk if OS primitives prevent complete elimination.

---

### Task 3: Secret/DLP invariant tests

**Files:**
- Extend PR1 security tests.
- Extend `packages/security/test/dlp.unit.test.ts` and sensitive tests.

- [ ] Prove synthetic secrets do not appear in file read/search output, process/command output, audit, diagnostics, activity feed, approval persistence, process persistence, or config export.
- [ ] Test common token formats and high-entropy fallback behavior.
- [ ] Verify masked SENSITIVE content does not become plaintext through an alternate resource/prompt endpoint.

---

### Task 4: Identity/authorization property tests

**Files:**
- Extend PR2 ownership tests.

- [ ] Build actor/subject/workspace/session permutations and assert only exact allowed ownership tuples succeed.
- [ ] Verify leaked valid IDs are insufficient for approval/change/process access.
- [ ] Verify local-admin routes remain functional and are not accidentally exposed through MCP.

---

### Task 5: IPC and Worker boundary audit

**Files:**
- Extend `packages/ipc/test/*` and Worker security tests.

- [ ] Test bad MAC, wrong daemon instance, expired envelope, future-issued envelope, replay nonce, oversized frames, malformed frames, and unknown operation kinds.
- [ ] Verify Worker never accepts unauthenticated raw operation data.
- [ ] Verify child environments never regain ambient Core/Worker secrets.

---

### Task 6: OAuth/token lifecycle audit

- [ ] Test refresh rotation/replay, revocation, expiration boundaries, stale cleanup interaction, PKCE binding, redirect URI exact match, and quota behavior.
- [ ] Verify registration cleanup never removes active token families.
- [ ] Verify OAuth error responses do not disclose token/client secrets.

---

### Task 7: Admin/CSRF/local-control audit

- [ ] Verify state-changing `/api/*` paths require valid admin session and same-origin metadata according to the documented browser threat model.
- [ ] Verify bootstrap/control-secret paths remain loopback-only by configuration and use constant-time secret comparison.
- [ ] Audit config export, audit export, SSE/activity and metrics for unintended sensitive fields.

---

### Task 8: Codex Security cross-check

Use Codex Security repository scan/hardening skills when available. Compare findings with the boundary inventory. Validate source paths before accepting scanner claims.

- [ ] Fix validated HIGH/CRITICAL findings test-first.
- [ ] Record lower-confidence/LOW-MEDIUM items in `docs/security/security-followups.md` when a compatible fix is not justified in this cycle.

---

### Task 9: Threat model and security docs

**Files:**
- Update `docs/specs/02-security-model.md`.
- Update relevant MCP/workspace/OAuth specs.
- Create/update `SECURITY.md` if repository policy warrants it.

Document immutable guard order, YOLO limits, sensitivity classes, ownership tuple, child-env model, OAuth quotas, residual risks, and response/rollback guidance.

---

### Task 10: Final verification

- [ ] `npm run format:check`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run test:security`
- [ ] `npm run test:coverage`
- [ ] `npm run build`
- [ ] Review security-boundary inventory: zero undocumented privileged gaps.
- [ ] Review validated finding list: zero unresolved HIGH/CRITICAL findings.
