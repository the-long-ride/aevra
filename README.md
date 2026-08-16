# Aevra

Aevra is a **local, workspace-scoped MCP execution gateway for AI clients**. Remote clients connect to the canonical HTTPS `/mcp` endpoint using Aevra OAuth or an advanced Bearer connector. Aevra then applies session, workspace, capability, permission, risk, approval, recovery, and audit rules before an isolated local Worker touches files or runs commands.

The product has two deliberately separate planes:

```text
Internet / AI client MCP
        |
Cloudflare Tunnel
        |
127.0.0.1:47832  remote MCP data plane
        |
Aevra Core Daemon  -- policy / approvals / sessions / audit
        |
authenticated named pipe or Unix socket
        |
Execution Worker    -- filesystem / Git / command / sandbox / process execution

127.0.0.1:47831  localhost-only admin control plane
        |
Aevra Web UI
```

The central invariant is:

> **The Core decides authority. The Worker executes only the exact authority it receives.**

## Requirements

- Node.js **22.5+**
- npm
- Git for Git tools
- `cloudflared` for remote connectivity
- Docker or Podman for strict command sandboxing; host-workspace fallback is separately policy-gated

Custom remote MCP availability and tool capabilities depend on the AI account/workspace you use. Aevra does not bypass client-side product limits.

## Install from source

```bash
npm install
npm run build
npm link
```


## Start Aevra

Foreground/debug mode:

```bash
aevra start
```

Start the daemon and open the authenticated dashboard as soon as it is ready:

```bash
aevra start --ui
```

Default listeners:

```text
Admin UI/API:  https://localhost:47831
Remote MCP:    https://localhost:47832/mcp
MCP health:    https://localhost:47832/health
```

Both listeners are HTTPS and remain bound to `127.0.0.1` only. On first start Aevra creates a persistent localhost certificate for `localhost`, `127.0.0.1`, and `::1` and attempts to trust it for the current user. The Cloudflare Tunnel must target **only** port `47832`.

Open an authenticated local admin session when Aevra is already running:

```bash
aevra ui
```

`aevra ui` reads Aevra's user-local control secret, requests a short-lived one-time bootstrap URL, opens it in the browser, and exchanges it for an HttpOnly `SameSite=Strict` admin cookie. The reusable control secret is never sent to browser JavaScript.

Revoke all local dashboard sessions:

```bash
aevra ui --logout-all
```

## Register workspaces

Workspace roots are configured **only in the localhost Web UI**. Remote MCP cannot create, remove, or modify filesystem roots.

For each workspace configure:

- name and description;
- host root;
- optional external mounts;
- actor/workspace admission profile;
- execution and timeout preferences.

External mounts have a logical path and their own capabilities. The AI client sees a logical path such as `/external/shared-sdk`; it does not receive the host absolute path.

Aevra canonically resolves filesystem paths and blocks traversal through `..`, symlinks, junctions, or reparse points when the final target escapes a registered capability root.

## Configure remote access

The recommended first-run path is **Dashboard -> Getting Started -> Remote Access**. It detects `cloudflared`, checks whether existing Cloudflare credentials already work, creates or selects a tunnel, routes the public hostname, and tests reachability without requiring Cloudflare Access.

Aevra publishes one canonical MCP endpoint:

```text
https://<host>/mcp
```

**Aevra OAuth** is the recommended authentication method for ChatGPT and other OAuth-capable MCP clients. Cloudflare Access is optional and can be added as an extra network identity gate from advanced Settings. Aevra OAuth does not require a Cloudflare Access issuer or audience.

The CLI remains available as an alternative:

```bash
aevra setup
```

The hostname field accepts either `mcp.example.com` or `https://mcp.example.com` and stores only the DNS hostname. Paths, ports, and non-HTTPS URL schemes are rejected before Cloudflare is changed.

Aevra supports two tunnel ownership modes:

- **managed** - Aevra owns the `cloudflared` child it started;
- **external** - another service owns the tunnel and Aevra only checks configuration/reachability.

Aevra never stops or restarts an externally owned tunnel.

## Connect an AI web interface

On first run, open **Getting Started -> Connect an AI**. Aevra shows the public server URL and pending local pairing requests.

### ChatGPT

Use:

```text
Server URL: https://<host>/mcp
Authentication: OAuth
```

ChatGPT discovers Aevra's OAuth metadata, starts Authorization Code with PKCE S256, and waits for authorization. Aevra does not release the authorization code until the connection is approved in the localhost dashboard. Verify the client and pairing code, then choose **Allow**.

Access tokens are short-lived. Refresh credentials rotate when used, and raw bearer secrets are not stored in SQLite.

### Other OAuth-capable clients

Use the same `https://<host>/mcp` URL and OAuth discovery flow. Local approval is still required for the pairing request.

### Advanced static Bearer clients

For clients that cannot perform OAuth but can send a custom Authorization header, create a connector in **Connectors**. The token is shown once. Configure the client with:

```http
Authorization: Bearer <token>
```

Do not put new connector credentials in URLs. Legacy `/mcp/<token>` admission remains compatibility-only for older clients and can be revoked through the Connectors page.

### Optional Cloudflare Access

Cloudflare Access can be enabled as an additional gate in Settings. In Access mode Aevra verifies the Access JWT before accepting that path. Forwarded identity headers by themselves are never authorization input.

A normal OAuth connection is:

```text
AI client
  -> https://<host>/mcp
  -> OAuth discovery + PKCE
  -> local approval of the pairing request
  -> Bearer access token
  -> Aevra admission
  -> new security session ID
  -> client selects a pre-registered workspace
  -> Aevra creates one workspace lease for that session
```

The client cannot choose Aevra's security session ID. Reconnects create fresh sessions.

## MCP tools

The stable tool vocabulary includes:

```text
aevra_status
workspace_list workspace_select workspace_current
file_list file_read file_search
file_create file_write file_patch file_move file_delete
command_run
git_status git_diff git_log git_branch git_commit git_push
process_start process_list process_logs process_stop process_restart
change_begin change_status change_commit change_rollback
approval_status approval_wait approval_cancel
skills_list skill_read instructions_read
```

Tool visibility is not authorization. Every operation is still checked against the active workspace lease and capabilities.

### Skills and instructions

Aevra serves the same skill convention local coding agents use:

- `skills_list` — skills found in `~/.agents/skills/<name>/SKILL.md` and `<active-workspace>/.agents/skills/<name>/SKILL.md`, with `name`/`description` read from YAML frontmatter.
- `skill_read` — full SKILL.md content plus the list of supporting files; `{source, name, file}` reads one supporting file (path-confined to the skill directory, 256 KB cap). Global skills live outside workspace roots and are reachable only through this tool.
- `instructions_read` — `~/.agents/AGENTS.md` plus the active workspace's `AGENTS.md` (falling back to `CLAUDE.md`), labeled by source.

These tools are read-only and available under every capability profile, including Read Only. Secret-classified files are masked before return, like `file_read`.

## Permissions and approvals

Reusable capability profiles include **Read Only**, **Developer**, and **Full Workspace**. An actor/workspace mapping can ask on every connection or auto-admit a fresh lease with a selected profile.

Remembered permission scopes are:

- Run once
- Allow this session
- Always in this workspace
- Always in all registered workspaces

ALLOW and DENY rules are supported. More-specific rules win; DENY wins at equal specificity. Critical operations never gain persistent always-allow authority.

When an operation needs step-up approval, Aevra briefly waits for a fast local decision. If still unresolved, MCP receives an `approval_pending` ticket. The dashboard can approve or deny it, but **clicking Allow does not execute anything**. Approval only arms the frozen request. The AI client must resume the ticket with `approval_wait`; Aevra then revalidates the actor, session, active workspace, lease, expiry, and expected state before execution.

## Command execution

Strict sandboxing is the default. The Worker tries Docker and then Podman. If neither strict backend is available, Aevra reports that sandbox execution is unavailable; it does not silently switch to the host.

A host-workspace command is a separate request and passes through permission/risk approval again.

Commands are classified into effects:

```text
READ_ONLY
BUILD_OUTPUT
SOURCE_MUTATION
REPOSITORY_STATE
UNKNOWN
```

Read-only operations can run concurrently. Source/repository mutations and unknown commands use conservative workspace locking. Build outputs can overlap only when their known output areas do not conflict.

Aevra never automatically elevates commands and does not run as root/SYSTEM by default.

## Concurrent edits

`file_read` returns a SHA-256 content version. Mutations use the expected version.

If another session changed the file first, Aevra may perform a safe three-way merge using the remembered base, current content, and requested content. It auto-merges only provably non-overlapping edits. Overlapping edits return `MERGE_CONFLICT` and write nothing.

## Change sets and recovery

Filesystem mutation is journaled independently of Git. Before a destructive mutation Aevra persists operation intent and recovery state, then executes through the Worker and records the result.

Change sets support begin/status/commit/rollback. Recovery snapshots are bounded by configured retention and size limits. Rollback validates current hashes and refuses to silently overwrite newer changes.

After a crash, incomplete mutating operations are reconciled. They are **never automatically replayed**. Aevra may report explicit states such as `INTERRUPTED`, `EXECUTION_OUTCOME_UNKNOWN`, or `RECOVERY_REQUIRED` instead of guessing.

## Managed processes

Long-running services use the explicit process tools rather than `command_run`. Each process belongs to one workspace. Remote process control is available only while that workspace is active; the localhost dashboard can inspect all registered process records.

Process logs are bounded and redacted before remote return. Records whose post-restart ownership cannot be proven are treated as ownership-uncertain and are not automatically signaled.

## Sensitive files and secrets

Sensitive-file classification combines path/name rules and policy metadata. Secret-like files such as `.env` are masked for remote reads by default.

Environment profiles contain normal variables plus secret references. Raw secret values are not stored in SQLite. Aevra uses a per-user OS credential backend where available and has an AES-256-GCM encrypted local vault fallback. The fallback vault passphrase/derived key stays in memory only while unlocked.

Known injected values, credential patterns, and high-confidence secret material pass through Aevra's DLP layer before MCP output, process logs, and audit metadata.

## Audit, backups, and safe mode

Audit events are redacted and hash-chained with previous/content hashes. The Web UI can verify the chain and export redacted JSON or JSONL.

Defaults are designed around bounded retention, including audit metadata, process output tails, and recovery snapshots. SQLite backups use a consistent database backup operation rather than blindly copying a live WAL database.

If database integrity validation fails, Aevra starts in **SAFE MODE**. The local dashboard remains available for diagnostics/export/recovery, while remote execution and administrative mutations are blocked.

## User-scoped background service

Aevra runs as the current user:

```bash
aevra service install
aevra service start
aevra service status
aevra service restart
aevra service stop
```

Platform integration:

- Windows: current-user Scheduled Task triggered at logon
- Linux: `systemd --user`
- macOS: `~/Library/LaunchAgents`

Normal service installation does not request administrator/root elevation.

## State locations

Default state roots:

```text
Windows: %LOCALAPPDATA%\Aevra
macOS:   ~/Library/Application Support/Aevra
Linux:   $XDG_STATE_HOME/aevra or ~/.local/state/aevra
```

The state directory contains the SQLite metadata database, local control secret, recovery data, sandbox caches, encrypted fallback vault, and backups as applicable.


## Development

Fast checks:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:contract
npm run test:integration
npm run test:security
npm run test:web
npm run build
```

Docker/Podman conformance tests explicitly skip when the local engine is absent; dedicated CI backend jobs are expected to run where the engine is available.

The implementation intentionally keeps these dependency boundaries:

- Core authorizes workspace operations but does not perform them directly;
- MCP tool code does not import Worker executor implementations;
- the Web UI never imports Worker/IPC code;
- the Worker never imports Core policy, store, or admin code.

## Documentation

Short, 2-minute documents live under [`docs/`](docs/README.md):

- [`docs/specs/`](docs/specs/README.md) — how Aevra works inside (for engineers and AI agents)
- [`docs/user-manual/`](docs/user-manual/README.md) — how to install, connect Claude.ai / ChatGPT / Gemini, and manage workspaces
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — known weak points and the prioritized feature roadmap

## Troubleshooting

**`401 unauthorized` on `/mcp`** - expected before authentication. OAuth-capable clients should follow the `WWW-Authenticate` protected-resource metadata and complete OAuth. Static clients must send `Authorization: Bearer <token>`.

**`SESSION_WORKSPACE_REQUIRED`** — select one of the locally registered workspaces with `workspace_select`.

**`CAPABILITY_REQUIRED`** — the active workspace lease/profile does not grant that capability, or a policy gate blocked it.

**`APPROVAL_PENDING`** — open `aevra ui`, review the request, then let the AI client resume the ticket.

**`APPROVAL_CONTEXT_CHANGED`** — the approved frozen request no longer matches the current session/workspace/repository state. Request the operation again against current state.

**`EXECUTOR_UNAVAILABLE` while running a command** — the Worker is unavailable or no strict Docker/Podman sandbox backend is present. Host fallback must be requested and authorized separately.

**`WORKSPACE_ESCAPE`** — the resolved path leaves the locally registered workspace/mount capability roots.

**`MERGE_CONFLICT`** — two sessions edited overlapping content. Aevra wrote nothing; reread and resolve the conflict explicitly.
