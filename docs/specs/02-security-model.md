# 02 — Security Model

**Audience:** engineers & AI agents · **Scope:** admission, sessions, authority · **Verified against:** `1.1.1`

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
- **Multiple workspace grants per connection:** An OAuth connection can hold multiple durable workspace grants simultaneously. Granting a workspace persists in `oauth_connection_workspace_grants`; revoking one grant leaves other workspace grants intact.
- **Dynamic runner VMs and rotating IPs:** Cloud AI providers (ChatGPT, Claude) dispatch requests across ephemeral VM pools with rotating egress IPs. Connection identity is derived strictly from cryptographic OAuth token validation, never IP address or client display headers.
- **Independent rate-limiting boundaries:**
  1. Authenticated OAuth requests are governed by a shared connection-level token bucket (120 burst capacity, 20/s refill) so rotating IPs cannot bypass limits while legitimate traffic is never starved by foreign callers.
  2. Static connectors use dedicated connector rate limiting.
  3. Unknown/invalid bearer attempts are throttled by an independent invalid-bearer bucket (30 burst, 1/s refill, returning `429` with `Retry-After`), preventing invalid-token flood attacks from exhausting valid connection or connector quotas.
- **Atomic approval execution claims:** Approved tickets record the owning connection subject. Resuming an approved ticket atomically transitions state to `EXECUTING` via an atomic database claim, preventing duplicate executions across racing runner VMs. Unauthorized callers attempting resumption receive `APPROVAL_UNAUTHORIZED` without modifying the ticket's state, preventing ticket poisoning attacks.
- **Request provenance and bounded origins:** Audit records capture immutable request provenance (`remoteIp`, `userAgent`, `requestId`). The last 10 unique runner IPs per connection subject are persisted with timestamps in `oauth_connection_origins` (pruned after 24 hours) for operator visibility.
- Remembered workspace grants are **restored lazily**: creating or resuming a session records that a restore is owed, and the leases are admitted when the session first reads them. The restore runs at most once per session, so concurrent first use cannot admit a lease twice, and a session that never touches a workspace never writes lease rows. Reconnect re-arms the restore, which is what repairs leases that expired while the connection was away.
- Remembered OAuth workspace grants and connection-level YOLO survive transport reconnects and Core restarts. Session-only grants are rebound only while their original lease is still valid.
- Disconnecting one MCP session starts the configured reconnect grace window; revoking the OAuth connection invalidates its credentials, live sessions/leases, remembered workspace grants, and YOLO state.
- Switching workspaces drains in-flight operations first; a switch in progress blocks new mutating calls.
- Admin plane sessions are separate: HttpOnly `aevra_admin` cookie, issued via username/password login; startup revokes persisted admin sessions. Remote Admin requests are accepted only from the local origin, configured `adminPublicUrl`, or exact HTTPS origins in `trustedAdminOrigins`. Forwarded host/proto headers never create trust. State-changing Admin requests require **positive** same-origin evidence — `Sec-Fetch-Site: same-origin|none`, or a matching `Origin` — and a request presenting neither is accepted only from a loopback peer.
- Admin password throttling is failure-oriented: each login attempt reserves limiter capacity, a successful credential verification immediately refunds that reservation, and failed attempts consume it. Exhaustion returns `429` with `Retry-After`; repeated successful local CLI/UI logins therefore cannot lock out valid administration.
- The public gateway proxies the Admin plane **only** when exposure is local-only or an `adminPublicUrl` is explicitly configured. Otherwise non-MCP paths return `404` without reaching the Admin upstream, so enabling a tunnel does not publish the Admin UI or its login endpoint.

## Authority — capabilities

A lease carries a profile: **Minimal**, **Read Only**, **Safe Dev**, **Power Dev**, **Full Workspace**, or **Custom**. Capability vocabulary: `files.read` `files.search` `git.read` `files.write` `files.delete` `commands.run` `git.commit` `git.push` `network` `skills.read` `skills.write` `instructions.read` `instructions.write` `browser.control` `desktop.control`.

`browser.control` and `desktop.control` are off by default, are in no built-in profile, and are **not** implied by `network`: driving a browser reaches the user's logged-in web sessions, and driving the desktop reaches host applications and OS windows, which network access alone does not.

Tool visibility ≠ authorization: every operation is re-checked against the active lease.

## Approvals — step-up for risk

Risky operations pause for a local decision (fast-wait 20 s, then an `APPROVAL_PENDING` ticket). **Approving arms the frozen request — it executes nothing.** The AI client must resume via `approval_wait`, which revalidates actor, session, workspace, lease, expiry, capability, permission rules, and repository head. Ticket lifetimes: 5 min default, 2 min HIGH, 60 s CRITICAL.

Remembered scopes: run once · this session · always this workspace · always all workspaces. More-specific ALLOW/DENY rules win; DENY wins ties; critical operations never gain persistent always-allow (`policy.critical.alwaysConfirm`), and **YOLO does not override that** — the policy is evaluated before any YOLO short-circuit.

**YOLO has two operator-chosen modes (`policy.yolo`).** `workspace` (default) lets a YOLO session run unattended only while the work stays inside the workspace sandbox: host execution, network access, `git.push`, CRITICAL risk, and command bodies that elevate privilege, reach a remote host, touch system or home paths, change host services or the registry, drive a container or cluster runtime, publish, or traverse out of the workspace all still raise an approval. `unrestricted` waives that scope check entirely, must be selected deliberately in Settings, and still does not waive `policy.critical.alwaysConfirm`. Host execution stops counting as leaving the workspace only once the operator selects the native backend; an unset or unreadable backend is treated as sandboxed, so a settings gap cannot widen what runs unattended.

**Explicit DENY outranks YOLO in both modes.** Permission rules are evaluated before the YOLO short-circuit, so a standing DENY still refuses the operation. The command-body scan is a coarse net over text, not a boundary: quoting, encoding, or an interpreter can hide intent from it, and the sandbox, capability leases, and permission rules remain the enforcement mechanism.

**Destructive commands support one-time approval only.** Command matchers collapse positional arguments to `*`, so a standing grant authorizes more than the command that was reviewed: `shell:<shell>:*` excludes the script body entirely, and approving `rm -rf ./build` stores `rm:-rf:*`, which covers any other path. Persistent scopes are therefore refused for every shell operation and for any `commands.run` operation classified HIGH or CRITICAL. LOW and MEDIUM families keep their standing scopes.

**Platform caveat — Windows hosts using WSL bash.** Spawning WSL `bash` from Windows rewrites the command string before bash parses it: a bare `$NAME` is substituted (empty when unset) even inside single quotes, while `\$NAME` survives. Aevra passes argv to child processes unmodified, so this is a platform interop artifact rather than an Aevra defect — but the consequence belongs here, because on that platform the string rendered in the approval preview is not necessarily the string bash executes. Scripts read from a file are unaffected and are the reliable form.

**What the approver sees is what runs.** Previews are stripped of Unicode control and format characters — ANSI escapes, zero-width spaces, and bidi overrides — so text cannot render differently from how it will execute. Text that executes verbatim gets a 4000-character preview budget, and any remaining truncation is reported explicitly via `truncated` and `previewFullLength` rather than hidden behind an ellipsis.

## Browser control

Behind `browser.control`, the `browser_*` tools drive a real browser. Risk is
decided by the origin the operation lands on, not by the tool name: reads on a
normal origin are LOW, input is MEDIUM, anything on a sensitive origin (banking,
mail, cloud consoles, identity providers, or any page carrying a password field)
is HIGH and takes a ticket, and any operation that **sends the browser
somewhere** is treated as a navigation - including `browser_tabs {action:'open'}`.

Four refusals are structural rather than policy, and no approval overrides them:

- **No page-script evaluation.** There is no `browser_evaluate` on any transport;
  a source test enforces its absence. Every action is a typed operation.
- **No typing into credential fields.** Password, one-time-code, and payment
  fields are refused in the page and again in the Worker.
- **No privileged surfaces.** `chrome://`, `chrome-extension://`, `devtools://`,
  `file://`, `view-source:`, and Aevra's own Admin UI are refused outright, never
  ticketed - otherwise an agent could re-permission itself through the UI it is
  driving.
- **No navigation carrying secret-shaped data.** Navigate URLs are DLP-scanned
  across query, fragment, and path.

Screenshots of sensitive origins are refused because pixels cannot be redacted.
Page text, snapshots, and logs return under the same untrusted-content marker as
file reads: a page instructing the agent is data, not a command.

Pairing mints a MAC'd token the Worker verifies offline; the Worker pins the
extension's origin. **Disconnect all browsers** bumps a revocation epoch that
invalidates every issued token and drops live sockets immediately.

## Desktop control and background automation

Behind `desktop.control`, `desktop_*` tools drive local OS windows and controls through the native platform helper (Windows UIA). Desktop automation supports two operational models:

1. **Foreground input injection:** `desktop_click`, `desktop_type`, `desktop_key`, `desktop_scroll` simulate direct user input into the focused window.
2. **Background semantic automation:** `desktop_describe(mode: 'background')`, `desktop_invoke`, `desktop_set_value`, `desktop_select`, `desktop_toggle`, and `desktop_release_window` perform direct control pattern operations on target windows without stealing keyboard focus or moving the human operator's mouse.

Safety boundaries for desktop control are strictly enforced:

- **Window gate direction:** `evaluateWindowGate` enforces directional boundaries (`'input' | 'capture' | 'background'`). Read-only capture/describe are permitted across visible windows. For foreground input, windows without resolvable executable metadata are refused unless `unattributedInput: 'allow'` is explicitly configured. For background automation, unattributable windows are **strictly refused** regardless of `unattributedInput: 'allow'`.
- **Exact-path app grants and access requests:** `desktop_request_access` creates a pending, ten-minute request bound to the caller, workspace, target window/process instance, and verified WebView2 host identity when applicable. Only an administrator decision can create a session grant or persistent canonical-executable-path grant. Session grants expire with their session; persistent grants are explicitly revocable. A grant never bypasses `desktop.control`, current window identity, protected-title rules, denylist policy, or per-action approval.
- **Protected surfaces & self-targeting:** The desktop helper refuses any window owned by Aevra itself (Core daemon, Admin UI, Worker, CLI) or elevated system processes, preventing an agent from re-permissioning itself or bypassing gateway boundaries.
- **Native OS security boundaries (UIPI & window stations):** Operating System User Interface Privilege Isolation (UIPI) prevents lower-integrity workers from injecting input or sending window messages to higher-integrity processes; violations fail closed with `DESKTOP_INPUT_REFUSED`. Operations across non-interactive window stations or lock screens are refused.
- **Background window leases:** Background semantic operations require an exclusive window lease (`sessionId`, `workspaceId`, 60-second sliding TTL). The lease prevents concurrent sessions or foreign workspaces from interleaving mutating actions on the same window (`DESKTOP_WINDOW_BUSY`). Leases are refreshed on activity and released explicitly via `desktop_release_window` or upon expiration.
- **Generational ref invalidation:** Element references (`ref_<generation>_<index>`) are tied to a single accessibility snapshot. Any change in window structure or helper restart marks earlier references stale (`DESKTOP_REF_STALE`). In background mode, target elements undergo runtime verification (matching handle, control type, and runtime ID) immediately prior to invoking patterns (`DESKTOP_TARGET_CHANGED`).
- **Focus change detection:** Foreground input operations verify that the target window has not lost focus between perception and actuation; unexpected focus shifts abort with `DESKTOP_FOCUS_CHANGED`.
- **Credential masking & audit sanitization:** Password, PIN, and credential input fields are masked in accessibility trees. String values passed to `desktop_set_value` and `desktop_type` are redacted from audit logs and approval records, recording only character length and cryptographic nonce. Screenshots and pixel captures are audited solely by SHA-256 hash, never storing image binary data.

## Prompt-injection posture

Aevra assumes the AI client may itself be under the influence of content it reads.

- Workspace-derived instructions (`AGENTS.md` from the active workspace) are delivered inside a labeled untrusted-content envelope that names their provenance and states they are data, not instructions. The closing delimiter is neutralized inside the body so content cannot forge an early close. User-global instructions, which the operator authors directly, are not wrapped.
- `file_read`, `file_search`, and `search` results carry `untrusted: true` and a notice stating the content is data rather than instructions. The marker travels **alongside** the content rather than wrapping it: `file_read` output doubles as the merge base for `file_patch`, so rewriting those bytes would corrupt subsequent writes. `file_search`'s output schema is `additionalProperties: false` and admits the two advisory fields explicitly.
- Command `stdout`/`stderr` is stripped of terminal control sequences before it reaches the model or an approval preview.

**Limits of this posture.** A marker is an advisory, not an enforcement boundary: a model that ignores it is still free to act on injected text. Provenance marking narrows the gap between "content the operator wrote" and "content a repository supplied"; it does not close it. Approvals remain the backstop, which is why preview integrity and one-time shell approval carry the real weight.

## Command understanding, workspace scope, and exact approval binding

In 1.1.0, command execution authorization is governed by structured semantic analysis (`packages/command-analysis`) rather than colon-delimited wildcard string matchers:

- **Graph-based semantic analysis:** Shell scripts across PowerShell (`pwsh` / `powershell`), CMD, Bash, `sh`, and `zsh` are parsed into abstract syntax graphs with explicit nodes, spans, redirects, and edges (`sequence`, `success`, `failure`, `pipe`, `subshell`) without executing untrusted script text. Nested invocations (`-Command`, `-c`, `-lc`, `/c`) preserve the outer launcher node and redirection targets while recursively analyzing children within strict budget bounds (64 KiB, 256 nodes, 4 nested levels, 1500 ms). Bash single-`&` background lists are separate authorization nodes, and malformed quoting fails closed.
- **Canonical workspace scope enforcement:** Effective working directory (`cwdLogical`) and all target operands (Git `-C`, npm `--prefix`, pnpm `--dir`, file redirections, operands) are evaluated against authorized workspace capability roots.
  - Sibling-prefix paths, dot-dot escapes, UNC shares, and symlinks/junctions escaping roots evaluate to `OUTSIDE_WORKSPACE`.
  - Commands that leave authorized workspace roots **strictly require human approval** under both normal mode and workspace YOLO mode. Only active unrestricted YOLO waives this prompt.
  - Dynamic or unresolvable targets evaluate to `DYNAMIC_SCOPE` and require explicit approval.
- **Typed Command Rules (V2) & Migration:** Command rules carry structured predicates (`CommandRuleV2`) specifying application, operation, scriptName, allowed modifiers, dialects, backends, and target scope. Broad legacy wildcards (`shell:*`, `npm:*`) are quarantined with `status: 'needs-review'` and cannot grant unattended execution authority.
- **Exact cryptographic approval binding:** Approval tickets are bound to exact SHA-256 request fingerprints plus canonical execution evidence: cwd and target canonical paths, executable and wrapper canonical identities/fingerprints, roots/backend/policy/environment/resolver revisions, and script evidence. Replay, retargeting, changed mounts/symlinks, or stale executable context fails with `APPROVAL_ALREADY_CONSUMED` or `CONTEXT_CHANGED`.
- **Resume-time network revalidation:** a command approval never freezes network authority. Every resume reclassifies requested destinations and applies the current network permission rules; a destination that became denied blocks execution.
- **Project script trust invalidation:** Named package scripts (`npm run <script>`) and lifecycle definitions are fingerprinted; modifying a script definition invalidates remembered trust with `SCRIPT_CHANGED`.
- **Batch shim safety (CVE-2024-27980 mitigation):** Windows `.cmd`/`.bat` shims are resolved and wrapped via `windowsShimCommand` with per-argument quoting across both direct commands and managed processes, rejecting unquotable metacharacters (`"%\r\n`) without resorting to generic `shell: true`.

## Administrative mutations & deletion safety

All administrative removals, deletions, and revocations in the Web UI are fail-safe and require explicit confirmation:

- **Mandatory confirmation dialogs:** No resource is deleted on single-click. Deleting a workspace, external mount, secret reference, lifecycle hook, network rule, command-family override, MCP upstream server, permission rule, remote MCP session, local admin session, custom desktop application record, or managed process requires confirming an interactive modal (`dialog.confirm`).
- **Standardized visual affordance:** Destructive removal buttons use the compact terminal marker `[x]` with semantic danger tone and explicit accessible labels (`aria-label` and `title`), preventing ambiguous or unintended clicks.
- **Fail-closed operations:** Cancelling any confirmation dialog aborts the request immediately without state mutations or background side-effects.

## Fail-closed rules & SecurityGuard

- Central `SecurityGuard` boundary enforces `SECRET` denial and `SENSITIVE` data masking with one-time mutation approval.
- Worker-side defense-in-depth blocks symlink and hard-link secret file bypasses.
- Safe mode (DB integrity failure) ⇒ both MCP paths return `503 SAFE_MODE`; admin mutations blocked.
- Sandbox unavailable ⇒ command fails; **no silent host fallback** (host execution is a separate, separately-approved request).
- Secrets: raw values never in SQLite; OS credential backend with AES-256-GCM vault fallback; DLP masks secrets in MCP output, logs, audit.

**Boundaries:** token storage details (`04`), execution internals (`06`).

**Related:** [`04-connectors`](04-connectors.md) · [`08-audit-recovery`](08-audit-recovery.md) · [`../user-manual/08-permissions-approvals`](../user-manual/08-permissions-approvals.md)

**Next →** [`03-mcp-protocol`](03-mcp-protocol.md)
