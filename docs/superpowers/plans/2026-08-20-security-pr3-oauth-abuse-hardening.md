# PR3 OAuth Abuse Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound public dynamic OAuth registration/authorization abuse without breaking normal OAuth clients.

**Architecture:** Add an OAuth admission guard in Core that owns rate/cap decisions, while OAuthRepository exposes usage/count/cleanup primitives. Protocol responses remain standard where practical; abuse errors reveal no sensitive client state.

**Tech Stack:** TypeScript, Node HTTP, SQLite, existing OAuth service/repository.

**Spec:** `docs/superpowers/specs/2026-08-20-security-hardening-central-guard-design.md`

## Global Constraints

- Start from merged PR2.
- Preserve Dynamic Client Registration and PKCE flows.
- Never delete clients with active pending requests, authorization codes, access tokens, or refresh tokens.
- All counts and cleanup are bounded database operations.
- Defaults are configurable internally without adding new public protocol fields.

## Default limits

- registration attempts: 20 per 10 minutes per IP;
- pending authorization requests: max 5 per IP;
- pending requests: max 3 per client;
- dynamic OAuth clients: max 256 total;
- stale unused client retention: 30 days.

These defaults may be moved to Core settings/config constants without changing endpoint shapes.

---

### Task 1: OAuthRepository usage and cleanup primitives

**Files:**
- Modify: `packages/store/src/migrations.ts`
- Modify: `packages/store/src/oauth.ts`
- Test: `packages/store/test/oauth.unit.test.ts`

**Interfaces:**
- Store `last_used_at` for dynamic clients.
- Add count methods for clients and pending requests by client/IP.
- Add `touchClient(clientId)`.
- Add `cleanupStaleClients(cutoff)` that excludes any active OAuth state/token.

- [ ] Write failing cleanup tests with stale-unused vs stale-with-refresh-token clients.
- [ ] Add additive migration/indexes.
- [ ] Implement bounded SQL queries and cleanup transaction.
- [ ] Run store OAuth tests GREEN.

---

### Task 2: OAuthAdmissionGuard

**Files:**
- Create: `apps/core/src/auth/oauth-admission.ts`
- Test: new `apps/core/test/oauth-admission.unit.test.ts`

**Interfaces:**
- `register(ip)` -> allow/rate-limited/quota-full.
- `authorize(ip, clientId)` -> allow/pending-limit.
- Uses an in-memory per-IP limiter plus repository counts.

- [ ] Write failing rate-window, per-IP pending, per-client pending, and total-quota tests.
- [ ] Implement guard with deterministic retry behavior and no client-existence leakage in abuse responses.
- [ ] Run unit tests GREEN.

---

### Task 3: Route registration through admission guard

**Files:**
- Modify: `apps/core/src/mcp/oauth-routes.ts`
- Modify: `apps/core/src/mcp/server.ts` or options types
- Modify: `apps/core/src/runtime.ts`
- Test: `apps/core/test/mcp-oauth.integration.test.ts`
- Test: new `apps/core/test/oauth-abuse.integration.test.ts`

- [ ] Write HTTP flood tests for `/oauth/register` and `/oauth/authorize`.
- [ ] Pass remote IP and admission guard to OAuth route handler.
- [ ] Return `429` for rate limit and bounded generic OAuth-compatible errors for quota/cap cases.
- [ ] Touch client on successful authorization/token activity.
- [ ] Run OAuth integration tests GREEN.

---

### Task 4: Safe stale cleanup schedule

**Files:**
- Modify: `apps/core/src/runtime.ts`
- Optionally create: `apps/core/src/auth/oauth-cleanup.ts`
- Test: OAuth cleanup tests

- [ ] Trigger cleanup on startup and low-frequency timer, not per request.
- [ ] Stop timer during runtime cleanup.
- [ ] Prove active-token clients survive cleanup.
- [ ] Prove cleanup cannot delete a client between authorization and token exchange when active code/pending state exists.

---

### Task 5: Abuse observability

**Files:**
- Modify: metrics/audit call sites
- Test: abuse integration tests

- [ ] Record aggregate registration/authorization throttles without storing tokens, codes, PKCE values, or sensitive request data.
- [ ] Keep remote error body generic.

---

### Task 6: PR3 full verification

Run format, lint, typecheck, OAuth unit/integration/security tests, complete test suite, coverage and build. Run a bounded registration flood test and inspect SQLite row count to prove storage remains bounded.
