# MCP Migration Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the review findings in Aevra's MCP `2026-07-28` migration without regressing legacy MCP clients.

**Architecture:** Keep modern protocol validation/decorating in the focused MCP modules, but move identity-bound application session reuse into `SessionManager`. Strengthen protocol correctness at the ingress boundary and preserve wire-level JSON types.

**Tech Stack:** TypeScript, Node.js HTTP, node:test, Aevra SessionManager and MCP dispatcher.

**Spec:** `docs/superpowers/specs/2026-08-22-search-hooks-middleware-design.md`

## Global Constraints

- Modern protocol revision is exactly `2026-07-28`.
- Legacy revisions `2025-11-25`, `2025-06-18`, and `2025-03-26` keep existing initialize/session behavior.
- Modern transport never emits `Mcp-Session-Id`.
- Existing coverage thresholds must not be reduced.

---

### Task 1: Identity-bound session reuse

**Files:**
- Modify: `apps/core/src/sessions/session-manager.ts`
- Modify: `apps/core/src/mcp/modern-runtime.ts`
- Test: `apps/core/test/session-manager.unit.test.ts`
- Test: `apps/core/test/mcp-modern.integration.test.ts`

**Interfaces:**
- Produces: `SessionManager.getOrCreateForIdentity(identity: VerifiedRemoteIdentity, remoteIp?: string): { session: SecuritySession; created: boolean }`.

- [ ] **Step 1: Add failing session reuse tests**

```ts
const first = sessions.getOrCreateForIdentity(identity, '127.0.0.1');
const second = sessions.getOrCreateForIdentity(identity, '127.0.0.2');
assert.equal(first.session.id, second.session.id);
assert.equal(first.created, true);
assert.equal(second.created, false);
assert.notEqual(
  sessions.getOrCreateForIdentity({ ...identity, subject: 'other' }).session.id,
  first.session.id,
);
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run the repository's node:test command for `session-manager.unit.test.ts` and `mcp-modern.integration.test.ts`; expected failure is missing `getOrCreateForIdentity`.

- [ ] **Step 3: Implement session reuse and switch modern runtime to it**

```ts
getOrCreateForIdentity(identity: VerifiedRemoteIdentity, remoteIp?: string) {
  const existing = [...this.sessions.values()].find(
    (session) => session.actor === identity.actor && session.subject === identity.subject,
  );
  return existing
    ? { session: existing, created: false }
    : { session: this.create(identity, remoteIp), created: true };
}
```

Modern runtime consumes the new API and emits `session_start`/`session_reconnect` later through the hook integration point rather than scanning `list()`.

- [ ] **Step 4: Run focused tests and confirm pass**

Expected: session manager and modern integration tests pass.

### Task 2: MCP 2026 wire hardening

**Files:**
- Modify: `apps/core/src/mcp/modern-protocol.ts`
- Modify: `apps/core/src/mcp/server.ts`
- Modify: `packages/mcp-tools/src/register.ts`
- Test: `apps/core/test/mcp-modern-protocol.unit.test.ts`
- Test: `apps/core/test/mcp-modern.integration.test.ts`

**Interfaces:**
- Produces locale-independent tool ordering, Base64 `Mcp-Name` validation, correct unsupported-discovery error, and arbitrary-JSON structured content.

- [ ] **Step 1: Add failing tests for reviewed gaps**

```ts
assert.doesNotThrow(() => validateModernRequest(
  request({
    'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
    'mcp-method': 'tools/call',
    'mcp-name': `=?base64?${Buffer.from('file read').toString('base64')}?=`,
  }),
  body('tools/call', { name: 'file read', arguments: {} }),
));

assert.deepEqual(structuredContentForProtocol(['a'], MODERN_PROTOCOL_VERSION), ['a']);
assert.equal(structuredContentForProtocol(7, MODERN_PROTOCOL_VERSION), 7);
```

Add an HTTP test that sends `server/discover` with an unsupported explicit protocol revision and expects `-32022` with `data.supported` and `data.requested`.

- [ ] **Step 2: Run focused MCP tests and confirm failures**

Expected: reviewed edge cases fail on current implementation.

- [ ] **Step 3: Implement protocol fixes**

Use ordinal comparison:

```ts
const byName = (a: any, b: any) => {
  const left = String(a?.name ?? '');
  const right = String(b?.name ?? '');
  return left < right ? -1 : left > right ? 1 : 0;
};
```

Keep Base64 sentinel decoding strict by validating canonical Base64 round-trip before comparing decoded values. Route unsupported `server/discover` revisions through the existing `-32022` response path. Restore `RemoteIdentityVerifier` as the constructor field type.

Make dispatcher structured content protocol-aware so MCP 2026 preserves arrays, primitives, objects, and null exactly, while legacy behavior can retain the existing object wrapper where required by current compatibility tests.

- [ ] **Step 4: Run focused MCP tests and confirm pass**

Expected: modern protocol/unit/integration and ChatGPT compatibility tests pass.

### Task 3: Coverage closure

**Files:**
- Modify only migration-related tests required by coverage diagnostics.

**Interfaces:**
- Consumes the coverage diagnostic emitted by the existing temporary final gate.

- [ ] **Step 1: Inspect the latest coverage diagnostic and map uncovered branches to migration code**
- [ ] **Step 2: Add behavioral tests for uncovered migration branches; do not add coverage-only production branches**
- [ ] **Step 3: Run node coverage and verify all existing 85% thresholds pass**
- [ ] **Step 4: Run lint and typecheck before moving to the search plan**
