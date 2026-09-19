# Architecture & Security Spec: Dynamic VM & Floating-IP OAuth Continuity

**Date:** 2026-09-17
**Status:** Accepted and Implemented — verified against full repository quality gate
**Scope:** Core, Store, MCP tools, Admin API, Web UI
**Plan:** [Implementation plan](../plans/2026-09-17-floating-ip-oauth-continuity.md)
**Decisions:** [Wayfinder map](../wayfinder/floating-ip-oauth-continuity/map.md)

## 1. Outcome and limits

A request authenticated as an existing, active OAuth connection retains its explicitly approved workspace grants when its source IP, worker VM, or transport session changes. An operator does not need to repeat connection-scoped admission solely because a runner changes.

This is authorization continuity, not a promise that Aevra can preserve a provider's VM, credentials, conversation context, or network stream. Missing/expired credentials still require authentication or refresh; revoked credentials are rejected. A client that loses its refresh token may require reconnection. Aevra cannot safely distinguish a stolen valid bearer token from its legitimate holder solely by source IP.

IP rotation is a supported scenario, not a verified explanation for every reported ChatGPT/Claude disconnect. Real-client validation must record negotiated protocol, response status, and session behavior without logging credentials. Do not claim provider compatibility solely from synthetic tests.

## 2. Current implementation baseline

- OAuth connection identity is the persisted subject, with actor and ACTIVE/REVOKED state checked by ConnectionStateStore.
- SessionRepository stores grants in **oauth_workspace_grants**, keyed by **(subject, workspace_id)** with profile_id as a value. There is no remembered_workspace_grants table.
- Multiple workspace leases already exist. activeLease() returns a lease only when exactly one is present; leases() already lazily restores remembered grants.
- Session admission, explicit connection grants, and once/session approval scopes are distinct existing behaviors.
- Static connector tokens are unprefixed random base64url values. A cn_ token namespace does not exist.
- ApprovalRepository serializes selected ticket fields; adding a TypeScript property alone does not persist it.
- ApprovalService.resume currently reads APPROVED, awaits validation, and writes EXECUTING without a conditional claim.
- Schema migrations currently end at version 13. Check the current maximum when implementing; never rewrite an applied migration.
- Legacy and modern MCP have separate dispatch paths in server.ts and modern-runtime.ts.

## 3. Identity and grant authority

### 3.1 Durable identity

Use the authenticated connection subject as connectionId. Resolve it against OAuthRepository and require ACTIVE status and matching actor/subject. Client display name, IP, MCP session header, or an arbitrary caller-provided string is not authority.

Connection-level Admin endpoints accept only an actual connection ID. Keep a separate session-to-connection adapter for existing tool callers; do not overload an unknown session ID into a trusted connection ID.

### 3.2 Multiple grants, explicit scope

Preserve a set of grants per connection: (connectionId, workspaceId, profileId). This revision replaces the previous ambiguous single-workspace “switch” promise. The UI says **Grant workspace**, **Change profile**, and **Remove grant**. Adding workspace B does not remove A. Existing tools that require one unambiguous workspace retain that requirement; this project does not invent an activeWorkspaceId.

Only explicit Admin connection-grant actions and approvals whose decisionScope is connection create durable grants. Existing auto-admission mappings retain their explicit configured behavior. A once/session admission must not call rememberWorkspaceGrant merely because its actor is OAuth.

Before mutation, validate active connection, existing workspace, existing profile, and existing capability/profile ceilings. Reject invalid inputs without persistent or live changes. Return a real grant result, including applied session IDs, rather than a fabricated WorkspaceLease for an offline connection.

Updating a profile replaces that workspace's lease in all matching live sessions, including downgrades. Removing a grant removes matching live and detached leases and the persisted grant so reconnect cannot resurrect it. Auto-admission is an independent authority source: if an explicit mapping still permits admission, show that fact; removing a remembered grant does not silently delete policy mappings. Revoking the whole connection always overrides both.

Grant mutations and in-memory fanout occur synchronously, without yielding, after validation. Persist the grant and replacement lease rows in one database transaction; publish the prepared in-memory changes only after commit. On failure leave both states unchanged. Authorization rechecks current authority immediately before starting an effect. A revocation prevents new execution; already-started external effects cannot be undone by this guarantee.

### 3.3 Lifecycle

| Event                                     | Required behavior                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| New runner / changed IP                   | Authenticate normally; inherit explicit connection grants                                  |
| Session detached or grace expired         | Drop transient state; retain durable grants                                                |
| Daemon restart                            | Restore grants after valid authentication; preserve existing approval restart cancellation |
| Once/session approval                     | Keep original scope and lifetime                                                           |
| Workspace/profile removed                 | Invalidate affected grants/leases; never silently substitute a broader profile             |
| Connection revoked or refresh replay      | Reject future authentication; invalidate live/detached access and pending execution        |
| Refresh family expired / credentials lost | Require normal authorization; no IP/name-based identity recovery                           |

Keep lazy restoration through the existing guarded helper. Changing create() to restore eagerly is unnecessary unless an actual transport regression demonstrates it. Grant/profile changes must also update existing sessions, not only newly created sessions.

## 4. Authentication and bounded traffic

### 4.1 Preserve connector compatibility

For Bearer authentication, first attempt OAuth verification. If it fails, perform a side-effect-free lookup of a valid existing static connector token. A known connector follows the existing connector admission limiter and policy. An unknown bearer receives 401 with an invalid_token challenge and resource metadata; it must not consume connector failure buckets.

Expose lookup and admission as explicit internal operations so a successful lookup does not bypass connector policy or update lastUsedAt before admission. Preserve /mcp/<token> behavior. No token-prefix heuristic, new token format, or implicit connector deprecation is introduced.

Unknown bearer attempts have their own bounded IP bucket, separate from valid OAuth/connector traffic. Apply it only to invalid credentials: capacity 30, refill 1/sec, 429 after exhaustion, with Retry-After. Retain request size/header limits and bounded bucket storage. Valid credentials remain usable from a shared IP after invalid attempts.

### 4.2 Authenticated limits

Add one shared limiter instance per server, keyed by verified OAuth connectionId across both legacy and modern dispatch: burst 120, refill 20/sec. Charge each authenticated runtime request once before side effects, including initialization/discovery; distinct IPs for one connection share a bucket and distinct connections do not. Return 429 and Retry-After on exhaustion. Remove buckets on revocation and prune idle entries; cap retained entries at 10,000. Use a monotonic/injected clock and document eviction behavior.

Dynamic registration remains separately bounded. Increase per-IP burst to 30 but retain the existing 1/minute refill, rather than increasing sustained unauthenticated registration sixtyfold without evidence. Add a daemon-wide registration bucket (burst 60, refill 1/sec), bounded client inventory/expiry using existing policy, and tests showing no unbounded persistent growth. If the existing client inventory policy is insufficient, add a 1,000 unapproved-client cap and reject new registrations at the cap; do not evict approved clients. Surface Retry-After without exposing tokens.

## 5. Approval ownership and execution

### 5.1 Persist ownership

Add nullable connection_subject to pending_approvals through the next additive migration. Capture it from the authenticated session resolver when requesting approval; never from MCP arguments. Round-trip it in ApprovalRepository as connectionId. Old rows stay null and session-bound; do not guess ownership by client name or backfill from expired sessions.

All approval status/wait/resume entrypoints check ownership before returning ticket data or mutating state. Match current authenticated connection and actor for connection-owned tickets; match original session and actor for legacy/static tickets. A foreign caller receives the existing not-found/unauthorized convention and must not poison a legitimate ticket into CONTEXT_CHANGED.

A connection-owned frozen operation may be resumed by another session of that connection. Revalidate the exact workspace's lease, current permissions, current grant/profile, expiry, revocation, repository preconditions, and original decision scope. A session-scoped permission does not migrate to another runner. Once approvals authorize only the frozen operation, never a durable capability. Resolve leaseForWorkspace(ticket.workspaceId), not activeLease(), for multi-workspace safety.

### 5.2 At most one execution attempt

After ownership checks and asynchronous precondition validation, atomically claim:

```sql
UPDATE pending_approvals
SET state = 'EXECUTING', updated_at = ?
WHERE id = ? AND state = 'APPROVED' AND expires_at > ?;
```

Only a caller with changes = 1 may execute. Recheck connection/grant authority immediately after claiming and before dispatching the effect. Conditional failure/finalization updates must not overwrite another caller's EXECUTING or terminal state. No database transaction remains open across an await.

Concurrent callers that lose the claim read the current state. EXECUTING yields an in-progress response; terminal tickets yield status without re-execution. Test with a barrier that lets both callers finish validation before claiming and assert the executor ran exactly once.

### 5.3 Lost responses and restart

A terminated runner does not cause server work to replay. A later authorized runner can poll the known request ID for state. If the operation succeeded but its response was lost, report SUCCEEDED and instruct inspection of workspace state; this revision does not promise durable replay of arbitrary result payloads.

On daemon restart, retain existing cancellation of PENDING/APPROVED tickets and mark leftover EXECUTING tickets INTERRUPTED with an outcome-unknown reason. Never automatically re-execute them. Exactly-once external effects across a crash are not promised. Durable result storage and general command idempotency are separate future work.

## 6. Transport and client acceptance

Preserve version-specific behavior:

- Legacy supported MCP versions: valid session header continues across IP changes; missing required header remains 400; unknown/expired session remains 404. A compliant client reinitializes and inherits grants. Do not attach another connection's session.
- Modern 2026-07-28: requests do not require initialize or Mcp-Session-Id; use authenticated connection identity and existing modern dispatch.
- All requests validate credentials. An old session header never rescues invalid credentials.
- Token refresh retains the connection subject. Concurrent reuse of a spent refresh token keeps strict replay revocation; do not add a grace bypass to mask provider races.
- Disconnect, grace expiry, restart, token expiry/refresh, profile downgrade, workspace removal, and revocation have explicit HTTP-level regression cases.

Live ChatGPT/Claude checks are a release-validation requirement, not a reason to weaken protocol/authentication rules. Record each provider's observed version, initialization/session behavior, and refresh outcome. If access is unavailable, mark live compatibility unverified and report synthetic coverage separately.

Protocol references: [2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [legacy 2025-11-25 transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html).

## 7. Request provenance and Admin UI

Capture immutable request context after trusted-proxy resolution: connectionId, sessionId, remoteIp, receivedAt, and requestId. Carry it through asynchronous dispatch and approval execution. Never derive operation provenance from a mutable session.remoteIp after awaiting.

Add optional connectionId, requestId, and receivedAt to audit input; existing remoteIp is already supported. Put these fields in the hashed event JSON. This records the observed peer/proxy address, not a provable unique VM identity. Do not claim the existing database created_at column is cryptographically covered.

Maintain a persisted recent-origin projection per connection: at most 10 distinct IPs seen within 24 hours, ordered by server-observed lastSeenAt. Prune expired entries on writes and reads. A new additive oauth_connection_origins table stores subject, remote_ip, last_seen_at with a composite primary key. Latest IP is the most recently observed origin, not the first session returned. Audit retention remains separate.

Admin connection projections read durable grants even while offline, with profiles and independently sourced auto-admission clearly distinguished. Retain existing session controls but explain that ending a session does not revoke a durable connection grant. Connection-grant routes use existing Admin authentication, origin/CSRF protections, and input validation. Grant removal and full connection revocation require the existing confirmation UI. Use the project's existing icon component, not literal [x] text.

## 8. Migration and security boundaries

Append migrations after the current maximum (13 at review time): nullable approval ownership and the bounded origin table. Preserve existing oauth_workspace_grants rows and multiple-workspace semantics. Verify fresh install, upgrade from a populated pre-change database, repeated startup, null ownership round-trip, rollback of a failed migration, and existing audit-chain verification.

Do not add activeWorkspaceId/profileId to OAuthConnectionRecord. Do not infer new durable permissions from historical session leases. Migration rollback requires restoring the pre-upgrade backup; do not promise old-binary compatibility with partially applied schema changes.

Bearer theft remains possible until expiry/revocation; refresh rotation detects refresh reuse, not access-token replay. Keep TLS and trusted-proxy constraints, capability ceilings, and critical-operation approvals. Optional provider CIDR allowlists, tenant identity, static-connector federation, and provider-side credential repair are outside scope.

## 9. Acceptance and handoff

The implementation plan maps every section to an executable task. Approval of this revised design is required before runtime implementation. Draft decision tickets remain in review until that approval; live provider evidence is a separate release gate. No runtime changes or commits are authorized merely by saving this document.
