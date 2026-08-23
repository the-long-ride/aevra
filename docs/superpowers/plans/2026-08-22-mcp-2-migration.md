# MCP 2.0 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP `2026-07-28` support to Aevra without breaking existing 2025-era clients.

**Architecture:** Detect the protocol era at ingress. Modern requests are validated and decorated by a focused `modern-protocol.ts` module and reuse an internal Aevra security session keyed by authenticated identity, while legacy requests keep their existing transport session flow.

**Tech Stack:** TypeScript, Node.js HTTP server, node:test, existing Aevra MCP tool service.

**Spec:** `docs/superpowers/specs/2026-08-22-mcp-2-migration-design.md`

## Global Constraints

- Modern protocol revision is exactly `2026-07-28`.
- Preserve `2025-11-25`, `2025-06-18`, and `2025-03-26` behavior.
- Never expose the internal Aevra security-session id as `Mcp-Session-Id` for modern requests.
- Keep OAuth failures distinct from protocol validation failures.

---

### Task 1: Modern protocol primitives

**Files:**
- Create: `apps/core/src/mcp/modern-protocol.ts`
- Test: `apps/core/test/mcp-modern-protocol.unit.test.ts`

**Interfaces:**
- Produces: `MODERN_PROTOCOL_VERSION`, `isModernRequest(req, body)`, `validateModernRequest(req, body)`, `modernDiscoverResult()`, `decorateModernResult(result)`.

- [ ] Write unit tests for protocol detection, required `Mcp-Method`, required `Mcp-Name`, header/body mismatch, discovery shape, server-info metadata, and cache metadata.
- [ ] Implement the helpers with JSON-RPC error code `-32020` for header validation failures.
- [ ] Run the focused unit test and commit.

### Task 2: Identity-bound internal security sessions

**Files:**
- Modify: `apps/core/src/sessions/session-manager.ts`
- Test: `apps/core/test/session-manager.unit.test.ts`

**Interfaces:**
- Produces: `getOrCreateForIdentity(identity, remoteIp?)` returning the existing matching security session or creating one.

- [ ] Add a failing test proving repeated calls for the same actor+subject reuse one internal session and different subjects do not.
- [ ] Implement identity-based reuse without changing legacy `create()` semantics.
- [ ] Run session manager tests and commit.

### Task 3: Modern ingress routing

**Files:**
- Modify: `apps/core/src/mcp/server.ts`
- Modify: `apps/core/test/mcp-chatgpt-compat.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 modern helpers and Task 2 `getOrCreateForIdentity`.

- [ ] Replace the deliberate modern-protocol rejection with modern validation and routing.
- [ ] Implement `server/discover` without `initialize` or `Mcp-Session-Id`.
- [ ] Route modern `tools/list`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`, and `tools/call` through the existing dispatcher using only the internal security-session id.
- [ ] Do not emit `Mcp-Session-Id` for modern responses.
- [ ] Decorate modern successful responses with server identity and required cache metadata.
- [ ] Keep legacy initialize/session behavior unchanged.
- [ ] Update the ChatGPT compatibility test from expecting rejection to expecting modern discovery success.
- [ ] Run focused MCP tests and commit.

### Task 4: Modern integration coverage

**Files:**
- Create: `apps/core/test/mcp-modern.integration.test.ts`

**Interfaces:**
- Tests the public HTTP behavior of `/mcp`.

- [ ] Test stateless modern `tools/list` without `Mcp-Session-Id`.
- [ ] Test stateless modern `tools/call` with `Mcp-Method` and `Mcp-Name`.
- [ ] Test missing/mismatched `Mcp-Method` and `Mcp-Name` return HTTP 400 / `-32020`.
- [ ] Test unsupported protocol revision returns a structured protocol error.
- [ ] Test repeated authenticated modern calls reuse application authorization state while still omitting protocol session headers.
- [ ] Run the modern integration tests and commit.

### Task 5: Regression and CI verification

**Files:**
- Modify only files required by failures found during verification.

- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run MCP-focused tests.
- [ ] Run the full test suite.
- [ ] Fix only migration-related failures and rerun until green.
- [ ] Push the final branch state, cancel superseded workflow runs, and confirm the latest workflow result.
