# 02 — Security Model

**Audience:** engineers & AI agents · **Scope:** admission, sessions, authority · **Verified against:** `1.0.4`

Security is two questions: **who gets in** (admission) and **what may they do** (authority). They never mix.

## Admission — two paths, one pipeline

| Path           | Credential                                   | Verified how                                                                                       |
| -------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/mcp`         | OAuth 2.0 / Cloudflare Access JWT            | RS256 signature, issuer, audience, expiry, subject — **every request**; JWKS cached 5 min          |
| `/mcp/<token>` | Connector token (22-char base64url, 128-bit) | SHA-256 lookup + constant-time compare; uniform `401 {"error":"unauthorized"}` for unknown/revoked |

Both paths then share the same session pipeline. Connector identity becomes `actor: "connector:<name>"`. See [`04-connectors`](04-connectors.md).

The `/mcp/<token>` form is **deprecated**: proxies, CDNs, and error pages log request lines, so the credential can outlive the request. Aevra itself never records the path, and responses on that path are `Cache-Control: no-store`, but prefer `Authorization: Bearer`.

**Request metadata is never a trust source by default.** Forwarded client-IP headers (`cf-connecting-ip`, `true-client-ip`, `x-real-ip`) are stripped by the public gateway and ignored by `remoteIp`, because rate limiting and the audit trail key on that address. Setting `exposure.trustedProxyClientIp` declares that an upstream proxy overwrites them and makes them believable again; routing headers (`x-forwarded-*`, `forwarded`) and the gateway trust headers stay stripped regardless. Leaving it off behind a proxy is safe against spoofing but collapses every remote client onto the gateway's loopback address, so they share one rate-limit bucket — stricter, but a denial-of-service surface, since one caller can exhaust the admin-login bucket for everyone. Forwarded host/proto headers likewise never create Admin-origin trust. Rate-limit state is bounded by LRU eviction so key cycling cannot exhaust memory.

Dynamic client registration is open by design but bounded: `client_name` is stripped of control characters and capped at 80 characters before it can reach an approval prompt, and registration is refused past 50 clients.

## Sessions, leases, and connection continuity

- Admitted identity -> fresh security session `ses_<uuid>` (client never chooses it).
- A session holds **workspace leases** (`lease_<uuid>`, capabilities attached, idle-expiry 30 min). General session activity refreshes every currently active workspace lease, but never revives an already-expired session-only lease.
- OAuth has a durable **connection identity** separate from an MCP session. Reconnect creates a fresh MCP session while preserving the authenticated connection subject.
- Remembered workspace grants are **restored lazily**: creating or resuming a session records that a restore is owed, and the leases are admitted when the session first reads them. The restore runs at most once per session, so concurrent first use cannot admit a lease twice, and a session that never touches a workspace never writes lease rows. Reconnect re-arms the restore, which is what repairs leases that expired while the connection was away.
- Remembered OAuth workspace grants and connection-level YOLO survive transport reconnects and Core restarts. Session-only grants are rebound only while their original lease is still valid.
- Disconnecting one MCP session starts the configured reconnect grace window; revoking the OAuth connection invalidates its credentials, live sessions/leases, remembered workspace grants, and YOLO state.
- Switching workspaces drains in-flight operations first; a switch in progress blocks new mutating calls.
- Admin plane sessions are separate: HttpOnly `aevra_admin` cookie, issued via username/password login; startup revokes persisted admin sessions. Remote Admin requests are accepted only from the local origin, configured `adminPublicUrl`, or exact HTTPS origins in `trustedAdminOrigins`. Forwarded host/proto headers never create trust. State-changing Admin requests require **positive** same-origin evidence — `Sec-Fetch-Site: same-origin|none`, or a matching `Origin` — and a request presenting neither is accepted only from a loopback peer.
- The public gateway proxies the Admin plane **only** when exposure is local-only or an `adminPublicUrl` is explicitly configured. Otherwise non-MCP paths return `404` without reaching the Admin upstream, so enabling a tunnel does not publish the Admin UI or its login endpoint.

## Authority — capabilities

A lease carries a profile: **Minimal**, **Read Only**, **Safe Dev**, **Power Dev**, **Full Workspace**, or **Custom**. Capability vocabulary: `files.read` `files.search` `git.read` `files.write` `files.delete` `commands.run` `git.commit` `git.push` `network` `skills.read` `skills.write` `instructions.read` `instructions.write`.

Tool visibility ≠ authorization: every operation is re-checked against the active lease.

## Approvals — step-up for risk

Risky operations pause for a local decision (fast-wait 20 s, then an `APPROVAL_PENDING` ticket). **Approving arms the frozen request — it executes nothing.** The AI client must resume via `approval_wait`, which revalidates actor, session, workspace, lease, expiry, capability, permission rules, and repository head. Ticket lifetimes: 5 min default, 2 min HIGH, 60 s CRITICAL.

Remembered scopes: run once · this session · always this workspace · always all workspaces. More-specific ALLOW/DENY rules win; DENY wins ties; critical operations never gain persistent always-allow (`policy.critical.alwaysConfirm`), and **YOLO does not override that** — the policy is evaluated before any YOLO short-circuit.

**YOLO has two operator-chosen modes (`policy.yolo`).** `workspace` (default) lets a YOLO session run unattended only while the work stays inside the workspace sandbox: host execution, network access, `git.push`, CRITICAL risk, and command bodies that elevate privilege, reach a remote host, touch system or home paths, change host services or the registry, drive a container or cluster runtime, publish, or traverse out of the workspace all still raise an approval. `unrestricted` waives that scope check entirely, must be selected deliberately in Settings, and still does not waive `policy.critical.alwaysConfirm`. Host execution stops counting as leaving the workspace only once the operator selects the native backend; an unset or unreadable backend is treated as sandboxed, so a settings gap cannot widen what runs unattended.

**Explicit DENY outranks YOLO in both modes.** Permission rules are evaluated before the YOLO short-circuit, so a standing DENY still refuses the operation. The command-body scan is a coarse net over text, not a boundary: quoting, encoding, or an interpreter can hide intent from it, and the sandbox, capability leases, and permission rules remain the enforcement mechanism.

**Destructive commands support one-time approval only.** Command matchers collapse positional arguments to `*`, so a standing grant authorizes more than the command that was reviewed: `shell:<shell>:*` excludes the script body entirely, and approving `rm -rf ./build` stores `rm:-rf:*`, which covers any other path. Persistent scopes are therefore refused for every shell operation and for any `commands.run` operation classified HIGH or CRITICAL. LOW and MEDIUM families keep their standing scopes.

**Platform caveat — Windows hosts using WSL bash.** Spawning WSL `bash` from Windows rewrites the command string before bash parses it: a bare `$NAME` is substituted (empty when unset) even inside single quotes, while `\$NAME` survives. Aevra passes argv to child processes unmodified, so this is a platform interop artifact rather than an Aevra defect — but the consequence belongs here, because on that platform the string rendered in the approval preview is not necessarily the string bash executes. Scripts read from a file are unaffected and are the reliable form.

**What the approver sees is what runs.** Previews are stripped of Unicode control and format characters — ANSI escapes, zero-width spaces, and bidi overrides — so text cannot render differently from how it will execute. Text that executes verbatim gets a 4000-character preview budget, and any remaining truncation is reported explicitly via `truncated` and `previewFullLength` rather than hidden behind an ellipsis.

## Prompt-injection posture

Aevra assumes the AI client may itself be under the influence of content it reads.

- Workspace-derived instructions (`AGENTS.md` from the active workspace) are delivered inside a labeled untrusted-content envelope that names their provenance and states they are data, not instructions. The closing delimiter is neutralized inside the body so content cannot forge an early close. User-global instructions, which the operator authors directly, are not wrapped.
- `file_read`, `file_search`, and `search` results carry `untrusted: true` and a notice stating the content is data rather than instructions. The marker travels **alongside** the content rather than wrapping it: `file_read` output doubles as the merge base for `file_patch`, so rewriting those bytes would corrupt subsequent writes. `file_search`'s output schema is `additionalProperties: false` and admits the two advisory fields explicitly.
- Command `stdout`/`stderr` is stripped of terminal control sequences before it reaches the model or an approval preview.

**Limits of this posture.** A marker is an advisory, not an enforcement boundary: a model that ignores it is still free to act on injected text. Provenance marking narrows the gap between "content the operator wrote" and "content a repository supplied"; it does not close it. Approvals remain the backstop, which is why preview integrity and one-time shell approval carry the real weight.

## Fail-closed rules & SecurityGuard

- Central `SecurityGuard` boundary enforces `SECRET` denial and `SENSITIVE` data masking with one-time mutation approval.
- Worker-side defense-in-depth blocks symlink and hard-link secret file bypasses.
- Safe mode (DB integrity failure) ⇒ both MCP paths return `503 SAFE_MODE`; admin mutations blocked.
- Sandbox unavailable ⇒ command fails; **no silent host fallback** (host execution is a separate, separately-approved request).
- Secrets: raw values never in SQLite; OS credential backend with AES-256-GCM vault fallback; DLP masks secrets in MCP output, logs, audit.

**Boundaries:** token storage details (`04`), execution internals (`06`).

**Related:** [`04-connectors`](04-connectors.md) · [`08-audit-recovery`](08-audit-recovery.md) · [`../user-manual/08-permissions-approvals`](../user-manual/08-permissions-approvals.md)

**Next →** [`03-mcp-protocol`](03-mcp-protocol.md)
