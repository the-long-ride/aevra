# 04 — Connectors

**Audience:** engineers & AI agents · **Scope:** the connector model and its lifecycle · **Verified against:** `0.1.2`

A **connector** is a named admission credential for one AI client — the thing that makes "works with any web AI" true, because the client needs no auth capability at all: the credential _is_ the URL.

## Model

```text
POST-create → { id: con_<uuid>, name, token (22 chars, shown ONCE) }
stored      → connectors table: name UNIQUE, token_hash = SHA-256(token), created_at, last_used_at
URL         → https://<public-url>/mcp/<token>
```

- Token: `randomBytes(16).toString('base64url')` — 128 bits, no dash/slash chars.
- The plaintext token exists only in the create response and the user's paste. Only the SHA-256 hash is persisted.
- Admitted identity: `actor: "connector:<name>"`, `subject: <connector id>` — flows into sessions, permissions, and audit like any actor.
- Optional policy bindings: default workspace, capability profile ceiling, and token expiry TTL.

## Verification semantics

1. Path matches `/^\/mcp\/([A-Za-z0-9_-]+)$/` → connector branch.
2. Token-bucket rate limiter checks IP address (`429 rate_limited` when exhausted).
3. Hash the presented token, look up by hash, constant-time compare.
4. Unknown, revoked, or connectors-not-configured → **byte-identical** `401 {"error":"unauthorized"}` — no oracle to distinguish them.
5. `last_used_at` updated at most once per minute (conditional UPDATE — no write amplification).
6. Revocation is a row delete → effective on the next request (no cache).
7. Token rotation: `POST /api/connectors/:id/rotate` issues a fresh token with a 5-minute grace window for the old token.

## Management — localhost only

| Route                             | Effect                                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| `GET /api/connectors`             | list (never returns token/hash)                                    |
| `POST /api/connectors {name}`     | create → `201` with token; duplicate name → `409 CONNECTOR_EXISTS` |
| `POST /api/connectors/:id/rotate` | rotate → `200` with new token and 5-min grace window               |
| `DELETE /api/connectors/:id`      | revoke                                                             |

Admin session + same-origin required; safe mode blocks mutations. There is **no connector management on the remote MCP surface** — no tool can create, list, or revoke connectors.

## OAuth connections are distinct

Static connector-token URLs remain admission credentials. OAuth clients instead receive a durable connection subject backed by rotating access/refresh credentials. The connection can enter a reconnect grace state after transport detach, retain remembered workspace grants and connection-level YOLO across a new MCP session, and expose its recent durable mutation outcomes through `operation_get` / `operation_list`. Admin **Disconnect session** affects one MCP session; **Revoke connection** invalidates the OAuth credential family and clears its remembered authority.

## Deployment rule

The Cloudflare Access application must cover **`/mcp` only** when used with Cloudflare Access. Connector URLs carry their own unguessable credential and must _not_ sit behind Access (a web AI client cannot complete an Access login). Both paths share everything downstream: sessions, leases, capability profiles, approvals, audit.

**Boundaries:** general admission (`02`), tunnel setup (manual `03`/`05`).

**Related:** [`02-security-model`](02-security-model.md) · [`../user-manual/03-remote-access`](../user-manual/03-remote-access.md)

**Next →** [`05-skills-instructions`](05-skills-instructions.md)
