# Live Dashboard, Request Presentation, and Coding Access Design

## Goal

Improve the local Aevra control plane so approval requests explain exactly what the remote AI wants to do, Dashboard runtime data updates continuously, completed onboarding moves out of the way, active remote connections are visible, provider guide actions are explicit, and read-only OAuth sessions can request a controlled coding-capability upgrade instead of dead-ending on `CAPABILITY_REQUIRED`.

## Request presentation

Every approval ticket is presented through one sanitized view model with `title`, `action`, `target`, and optional `preview`. This presentation is derived server-side from the frozen ticket payload and never exposes environment-variable values, tokens, credentials, OAuth secrets, or other secret-bearing fields.

The same presentation feeds:

- Requests drawer cards
- in-app toast text
- browser Notifications API messages
- OS notifications emitted by Aevra Core

Examples include `Delete /src/a.ts`, `Run PowerShell on host`, `Git push origin/main`, `Read workspace Aevra`, and `Enable coding access`.

Browser notifications remain opt-in. The Requests drawer exposes an explicit `Enable browser notifications` action so permission is requested from a user gesture. OS notifications remain best-effort and automatic.

## Live Dashboard

Add a lightweight `GET /api/dashboard/runtime` endpoint that returns one runtime snapshot instead of making many independent UI requests. The snapshot includes runtime health/statistics, metrics, pending request counts, active MCP sessions, active workspace leases, managed processes, open changes, connector inventory, and active connection rows.

The Dashboard polls this snapshot every 2 seconds only while Dashboard is active. The sticky Core/Worker/MCP/Tunnel header continues using its existing status refresh.

Core tracks a runtime `startedAt` timestamp so uptime is real and resets on restart.

## Active connections

Dashboard gains an `Active connections` table derived from live security sessions. Each row shows actor/client, authentication type, active workspace, connected time, last activity, and status.

Authentication display is derived from actor identity:

- `oauth:*` -> OAuth
- `connector:*` -> Bearer connector
- everything else -> Access/remote identity

This table is runtime-only and does not create a new persistent model.

## Onboarding lifecycle

Before onboarding is complete:

1. Remote Access
2. Onboarding
3. Runtime overview
4. Active connections
5. Tool activity
6. Connector management
7. Recent activity

After onboarding is complete:

1. Runtime overview
2. Active connections
3. Tool activity
4. Recent activity
5. Connector management
6. Onboarding at the bottom, collapsed by default

After completion, Remote Access moves inside the collapsed Onboarding section. Before completion it stays outside at the top.

Each ChatGPT, Claude, and Gemini example card has an explicit `Open guide` action that navigates to the existing provider guide chapter.

## Coding-agent capability adaptation

Workspace admission remains read-only by default. For OAuth connections, when an operation needs a capability absent from the current lease, Aevra may create a connection-scoped workspace profile-upgrade approval instead of returning an unrecoverable `CAPABILITY_REQUIRED`.

Add a builtin `coding-session` profile containing exactly:

- `files.read`
- `files.search`
- `git.read`
- `files.write`
- `commands.run`

Capability escalation uses the minimum built-in profile that covers the requested capability:

- `files.write` or `commands.run` -> `coding-session`
- `git.commit` or `network` -> `developer`
- `files.delete` or `git.push` -> `full-workspace`

The approval card shows which capabilities will be added. Approval is scoped to the current OAuth authorization connection + workspace, survives MCP transport reconnect/reinitialize for that OAuth grant, and is cleared on Aevra restart or OAuth reauthorization. Static Bearer connectors do not auto-escalate; their configured profile remains authoritative.

If an operation triggered the upgrade, `approval_wait` grants the new profile and resumes that frozen operation. Repeated attempts while the upgrade is pending reuse the same approval ticket.

A reconnect before local approval must reuse the same connection-scoped ticket; a reconnect after approval must restore the upgraded workspace lease automatically.

Skills/instructions remain a separate session-scoped read approval as already designed.

## Shell compatibility

`registry.ts` currently advertises `shell_run`; the implementation must ensure `McpToolService` actually dispatches it. `shell_run` continues compiling to the existing argv-based command pipeline, preserving sandbox/default execution, approval, DLP, timeout, output limits, and network policy.

## Security constraints

- No raw approval payload is rendered directly in the browser.
- No environment variable values appear in request presentation or notifications.
- Read-only workspace approval does not silently grant coding capabilities.
- Coding upgrade grants only the chosen built-in profile and is never persisted as an actor-wide/global permission rule.
- Critical operation approval rules remain unchanged.
- Connection-scoped grants remain in-memory and reset with Core restart.
- `main` remains untouched; implementation stays on `fix/chatgpt-mcp-xai-ui`.
