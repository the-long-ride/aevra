# 04 — Connectors

**Audience:** engineers & AI agents · **Scope:** the connector model and its lifecycle · **Verified against:** `0.4.0`

A **connector** is a named admission credential for one AI client — the thing that makes "works with any web AI" true, because the client needs no auth capability at all: the credential *is* the URL.

## Model

```text
POST-create → { id: con_<uuid>, name, token (22 chars, shown ONCE) }
stored      → connectors table: name UNIQUE, token_hash = SHA-256(token), created_at, last_used_at
URL         → https://<tunnel-host>/mcp/<token>
```

- Token: `randomBytes(16).toString('base64url')` — 128 bits, no dash/slash chars.
- The plaintext token exists only in the create response and the user's paste. Only the SHA-256 hash is persisted.
- Admitted identity: `actor: "connector:<name>"`, `subject: <connector id>` — flows into sessions, permissions, and audit like any actor.

## Verification semantics

1. Path matches `/^\/mcp\/([A-Za-z0-9_-]+)$/` → connector branch.
2. Hash the presented token, look up by hash, constant-time compare.
3. Unknown, revoked, or connectors-not-configured → **byte-identical** `401 {"error":"unauthorized"}` — no oracle to distinguish them.
4. `last_used_at` updated at most once per minute (conditional UPDATE — no write amplification).
5. Revocation is a row delete → effective on the next request (no cache).

## Management — localhost only

| Route | Effect |
|---|---|
| `GET /api/connectors` | list (never returns token/hash) |
| `POST /api/connectors {name}` | create → `201` with token; duplicate name → `409 CONNECTOR_EXISTS` |
| `DELETE /api/connectors/:id` | revoke |

Admin session + same-origin required; safe mode blocks mutations. There is **no connector management on the remote MCP surface** — no tool can create, list, or revoke connectors.

## Deployment rule

The Cloudflare Access application must cover **`/mcp` only**. Connector URLs carry their own unguessable credential and must *not* sit behind Access (a web AI client cannot complete an Access login). Both paths share everything downstream: sessions, leases, capability profiles, approvals, audit.

**Boundaries:** general admission (`02`), tunnel setup (manual `03`/`05`).

**Related:** [`02-security-model`](02-security-model.md) · [`../user-manual/03-create-connector`](../user-manual/03-create-connector.md)

**Next →** [`05-skills-instructions`](05-skills-instructions.md)
