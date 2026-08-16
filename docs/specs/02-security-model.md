# 02 — Security Model

**Audience:** engineers & AI agents · **Scope:** admission, sessions, authority · **Verified against:** `0.4.0`

Security is two questions: **who gets in** (admission) and **what may they do** (authority). They never mix.

## Admission — two paths, one pipeline

| Path | Credential | Verified how |
|---|---|---|
| `/mcp` | Cloudflare Access JWT | RS256 signature, issuer, audience, expiry, subject — **every request**; JWKS cached 5 min |
| `/mcp/<token>` | Connector token (22-char base64url, 128-bit) | SHA-256 lookup + constant-time compare; uniform `401 {"error":"unauthorized"}` for unknown/revoked |

Both paths then share the same session pipeline. Connector identity becomes `actor: "connector:<name>"`. See [`04-connectors`](04-connectors.md).

## Sessions and leases

- Admitted identity ⇒ fresh security session `ses_<uuid>` (client never chooses it).
- A session holds **at most one workspace lease** (`lease_<uuid>`, capabilities attached, idle-expiry 30 min, refreshed on activity).
- Switching workspaces drains in-flight operations first; a switch in progress blocks new mutating calls.
- Admin plane sessions are separate: HttpOnly `aevra_admin` cookie, issued via one-time bootstrap token + `x-aevra-control` secret; never exposed to browser JS.

## Authority — capabilities

A lease carries a profile: **Read Only**, **Developer**, **Full Workspace**. Capability vocabulary: `files.read` `files.search` `git.read` `files.write` `files.delete` `commands.run` `git.commit` `git.push` `network`.

Tool visibility ≠ authorization: every operation is re-checked against the active lease. Skills/instructions tools are read-only and available under every profile.

## Approvals — step-up for risk

Risky operations pause for a local decision (fast-wait 20 s, then an `APPROVAL_PENDING` ticket). **Approving arms the frozen request — it executes nothing.** The AI client must resume via `approval_wait`, which revalidates actor, session, workspace, lease, expiry, capability, permission rules, and repository head. Ticket lifetimes: 5 min default, 2 min HIGH, 60 s CRITICAL.

Remembered scopes: run once · this session · always this workspace · always all workspaces. More-specific ALLOW/DENY rules win; DENY wins ties; critical operations never gain persistent always-allow.

## Fail-closed rules

- Safe mode (DB integrity failure) ⇒ both MCP paths return `503 SAFE_MODE`; admin mutations blocked.
- Sandbox unavailable ⇒ command fails; **no silent host fallback** (host execution is a separate, separately-approved request).
- Secrets: raw values never in SQLite; OS credential backend with AES-256-GCM vault fallback; DLP masks secrets in MCP output, logs, audit.

**Boundaries:** token storage details (`04`), execution internals (`06`).

**Related:** [`04-connectors`](04-connectors.md) · [`08-audit-recovery`](08-audit-recovery.md) · [`../user-manual/08-approvals`](../user-manual/08-approvals.md)

**Next →** [`03-mcp-protocol`](03-mcp-protocol.md)
