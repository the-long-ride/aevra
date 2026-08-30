# Changelog

## [1.0.4] - 2026-08-30

- Restored missing runtime modules and fixed strict typecheck/build failures.
- Hardened OAuth client-IP handling, DLP path detection, and approval-modal keyboard focus.
- Added YOLO policy and onboarding/settings UI integrations with regression coverage.

All notable changes to this project are documented here.

## [Unreleased]

### Added

- **YOLO modes**: unattended automation now has two operator-chosen modes in
  Settings (`policy.yolo`, `GET`/`PATCH /api/policy/yolo`). `workspace` (default)
  auto-runs only work that stays inside the workspace sandbox and still raises an
  approval for host execution, network access, `git.push`, CRITICAL risk, and command
  bodies that elevate privilege, reach a remote host, touch system or home paths,
  change host services or the registry, drive a container or cluster runtime, publish,
  or traverse out of the workspace. `unrestricted` waives that scope check, is
  confirmed in the UI before it applies, and has to be selected
  deliberately; it still honors `policy.critical.alwaysConfirm`. A YOLO session also
  no longer stops for a per-command approval after clearing the capability gate.

### Security

Remediates an internal security audit. Each item carries a regression test in the
`.security.test.ts` suite.

- **Explicit DENY outranks YOLO**: permission rules are now evaluated before the YOLO
  short-circuit in both authorization gates, so a standing DENY refuses the operation
  instead of being skipped by a session flag.
- **Unknown sandbox backend fails closed**: an unset or unreadable
  `execution.settings.sandboxBackend` counts as sandboxed, so a settings gap can no
  longer let host execution run unattended under workspace-scoped YOLO.
- **Escape detection is linear**: the workspace-escape patterns no longer pair two
  tokens across a scan-to-end-of-line, which backtracked quadratically on a
  caller-controlled script body.

- **Slash-bearing secrets are redacted**: the generic entropy rule skipped every
  candidate containing `/`, so a base64 payload with a `/` in it passed through
  unredacted. Slash-bearing runs are now judged per segment - a long or
  mixed-case-with-digits segment is treated as an opaque payload, while ordinary path
  components (including Windows paths) still survive.
- **Client IP is no longer attacker-controlled**: `remoteIp` trusted the
  `cf-connecting-ip` header unconditionally and the public gateway did not strip it,
  so any remote client could mint a fresh rate-limit bucket per request and forge the
  origin address recorded in the audit trail. The gateway now strips
  `cf-connecting-ip`, `true-client-ip`, and `x-real-ip`, and `remoteIp` ignores them
  unless a caller explicitly opts in. `IpRateLimiter` additionally bounds its bucket
  and failure maps with LRU eviction so key cycling cannot exhaust memory.
- **Shell approvals are one-time only**: the permission matcher `shell:<shell>:*`
  excludes the script body, so approving a single shell command with a persistent
  scope authorized every future script. Persistent scopes are now refused for
  `commands.run` operations whose family begins with `shell:`.
- **Approval previews are trustworthy**: previews left Unicode control and format
  characters intact and truncated shell scripts at 180 characters, so a benign prefix
  plus padding could hide the real payload behind the ellipsis. Previews now strip
  Cc/Cf characters (ANSI escapes, zero-width spaces, bidi overrides), executable text
  gets a 4000-character budget, and any remaining truncation is reported through the
  new `truncated` and `previewFullLength` fields.
- **Workspace instructions are marked untrusted**: workspace `AGENTS.md` reached the
  model as a `role: user` prompt, so a hostile repository could place text in the
  highest-trust position available. Workspace-sourced instructions are now delivered
  inside a labeled untrusted-content envelope that also neutralizes forged
  delimiters. User-global instructions, which the operator authors, are unchanged.
  Command `stdout`/`stderr` is stripped of terminal control sequences.
- **YOLO honors `policy.critical.alwaysConfirm`**: YOLO short-circuited ahead of the
  policy check, contradicting the documented guarantee that critical operations never
  execute unattended. The policy is now evaluated first in both `gated()` and
  `authorizeCapability()`.
- **Admin is not published by default through a tunnel**: the public gateway routed
  every non-MCP path to the Admin plane, so enabling an exposure provider also
  exposed the Admin UI and its login endpoint. Admin proxying now requires either
  local-only exposure or an explicitly configured `adminPublicUrl`; otherwise those
  paths return `404` without reaching the upstream.
- **Destructive commands are classified correctly**: risk classification matched only
  abstract tokens that never appear in real command lines, so a recursive force
  delete of a filesystem root classified LOW. Added patterns for privilege
  elevation, filesystem creation and wipe, raw device writes, power-state changes,
  recursive delete, recursive `chmod`/`chown`, `npm publish`, and
  download-piped-to-interpreter.
- **Dynamic client registration is bounded**: `client_name` is unauthenticated input
  that renders into local approval prompts and OS notifications; it is now stripped
  of control characters and capped at 80 characters. Registration is refused with
  `too_many_clients` beyond 50 registered clients.
- **Admin CSRF checks require positive evidence**: a state-changing request carrying
  neither `Origin` nor `Sec-Fetch-Site` was accepted. Such requests are now accepted
  only from a loopback peer, which preserves the local CLI while closing the
  fail-open path.
- **Connector URL tokens are kept out of caches**: responses on the `/mcp/<token>`
  path set `Cache-Control: no-store`, and a one-time startup warning recommends the
  `Authorization: Bearer` form. Aevra itself never recorded the request path, so no
  audit or activity redaction was required.

- **Workspace read output carries provenance**: `file_read`, `file_search`, and
  `search` results are tagged `untrusted: true` with a notice stating the content is
  data rather than instructions. The marker travels alongside the content instead of
  wrapping it, because `file_read` output doubles as the merge base for `file_patch`
  and rewriting those bytes would corrupt subsequent writes; a regression test pins
  that byte-exactness. `file_search`'s output schema admits the two advisory fields
  explicitly, since it is `additionalProperties: false`.

### Known gaps

- Workspace-scoped YOLO judges command text with a pattern net, not a parser. Quoting,
  encoding, or an interpreter (`node -e`, a written-then-run script) can hide an escape
  from it; the sandbox boundary, capability leases, and permission rules remain the
  enforcement mechanism.
- Workspace-scoped YOLO also auto-runs in-workspace writes that execute later, such as
  `.git/hooks`, `package.json` scripts, and workspace skill files. They stay inside the
  workspace, so the scope check allows them, but they run the next time a human or a
  tool triggers them.
- Provenance marking is advisory, not enforcement. `file_read`, `file_search`, and
  `search` results carry `untrusted: true` and a notice, but a model that ignores the
  marker can still act on injected text. Approvals remain the backstop.

### Added

- **`git_add` tool**: stages files in the workspace index (`paths` list or `all: true` for `git add -A`). Classified LOW risk with no approval gate, matching the other read-adjacent Git tools.
- **`git_diff` short mode**: optional `short: true` input returns a compact `--stat` summary instead of the full patch text.
- **OAuth secret-persistence regression tests**: assert that access tokens, refresh tokens, PKCE verifiers, and authorization codes never reach durable storage in plaintext, that refresh rotation preserves the invariant, and that tokens stay verifiable from their stored hashes.

### Changed

- **Remembered workspace grants restore lazily**: creating or resuming a session now records that a restore is owed instead of re-admitting every remembered grant up front; the leases are admitted when the session first reads them, at most once per session. A session that never touches a workspace no longer writes lease rows, and concurrent first use cannot admit a lease twice. Reconnect re-arms the restore, preserving repair of leases that expired while the connection was away.

### Fixed

- **MCP structured-content schema violations**: seven tools could return a shape that failed their own declared (or default) output schema, surfacing as `Structured content does not match the tool's output schema` in strict MCP clients that validate `structuredContent`:
  - `file_list` and `file_search` returned bare arrays instead of an object; now `{ entries: [...] }` and `{ hits: [...] }` respectively, each with a matching output schema.
  - `workspace_list` returned a bare array; now `{ workspaces: [...] }` with a matching output schema.
  - `workspace_current` returned a bare `null` when no workspace was leased; now `{ status: 'none', workspace: null }`.
  - `process_list` returned a bare array even though its output schema already required `{ result: [...] }`; the handler now wraps its result to match.
  - `change_commit` resolved to `undefined` (`ChangeSetService.commit()` had no `return` statement); now returns `{ id, state: 'COMMITTED' }`.
  - `approval_status` / `approval_cancel` returned a bare `null` when the request wasn't found or approvals weren't configured; now return `{ status: 'not_found' }` or throw `CAPABILITY_REQUIRED` accordingly.

## [0.1.3] - 2026-08-28

### Added

- **Host System Capabilities Detection**: non-blocking, bounded probes for host OS details, arch, available shells (`pwsh`, `powershell`, `cmd`, `bash`, `zsh`, `sh`, `wsl`), platform-specific recommended shell resolution, and 11 toolchain categories (Git, Node.js/npm/npx/pnpm/yarn/bun, Python/pip/uv, .NET, Rust/Cargo, Go, JVM/Java/javac/Maven/Gradle, Ruby/RubyGems, PHP/Composer, native C/C++/GCC/Clang/CMake/Make, Docker/Podman); published via MCP `aevra_status` under `execution.system` and displayed in the Admin Dashboard.
- **Local Gateway Protocol & Transport Validation**: added `localProtocol` (`https` | `http`) configuration for the local loopback gateway while maintaining strict loopback HTTPS for internal Admin and MCP listeners; added interactive setup selection in `aevra setup` and a `TransportValidationModal` on the Admin Dashboard with runtime encryption checks and safety warnings.
- **Fast Lane batch tools**: added `file_read_many`, `file_write_many`, and `command_run_many` as the model-facing file-read, file-mutation, and bounded-command interfaces, with ordered per-item results, bounded concurrency, and existing Aevra security controls preserved.
- **React Admin Web UI Polish**: added a dedicated `System Capabilities` section to the Dashboard; `TransportValidationModal`; refactored `use-mcp-activity` hook for live event streams; added accessible `Dropdown` component with full keyboard navigation (arrows, enter, space, escape, focus management) and UI polish styles.

### Changed

- **Simplified MCP discovery surface**: `tools/list` now advertises 40 discoverable tools, hiding singular `file_read`, `file_create`, `file_write`, `file_patch`, and `command_run` primitives while retaining them internally for secure delegation and backward-compatible direct calls.
- **Batch write contract**: `file_write_many` publishes operation-discriminated create/replace/patch schemas, rejects duplicate paths prior to dispatch, and rejects fields that do not belong to the selected operation instead of silently discarding them.
- **Startup status output & safety warnings**: `aevra start` renders Core readiness, the MCP endpoint, and Dashboard URL in an aligned terminal table; warns clearly when running with a local HTTP loopback gateway. With `--ui`, the browser-opening line follows the table, and `Press Ctrl+C to stop Aevra.` is always the final startup line.
- **Documentation**: synchronized all engineering specs (01–09, README), user manual guides, and root README with Aevra v0.1.3, the 40-tool discoverable surface, Fast Lane batch operations, system capability detection, and transport validation.

### Fixed

- **Quality gate hangs**: MCP session integration cleanup now closes server/database resources even when assertions fail; Node test and coverage subprocesses have bounded timeouts and coverage batches identify suspect files instead of hanging CI indefinitely.
- **Fast Lane registry coverage**: updated stale registry expectations to distinguish stable internal singular primitives from the public batch tool surface.
- **Shell resolution**: command and shell tools now respect host capability probes and auto-resolve to the platform's recommended shell.

## [0.1.2] - 2026-08-26

### Added

- **OAuth connection continuity**: durable OAuth connection identity, configurable reconnect grace, rotating refresh-token families with replay revocation, remembered multi-workspace grants, persisted connection-level YOLO, and explicit session disconnect versus connection revocation semantics.
- **Durable operation inspection**: added read-only `operation_get` and `operation_list` MCP tools so reconnecting OAuth clients can inspect connection-owned mutation outcomes without automatically replaying writes, commits, deletes, or commands.
- **Independent Admin exposure**: added a separate `adminPublicUrl`, explicit exact-HTTPS `trustedAdminOrigins`, environment bootstrap via `AEVRA_ADMIN_PUBLIC_URL` / `AEVRA_TRUSTED_ADMIN_ORIGINS`, and an authenticated Admin reachability/trust probe.
- **Stable managed ngrok domains**: managed ngrok can request a configured stable HTTPS URL and fails closed if the discovered forwarding origin does not match.
- **Keep Awake policy**: added `off`, `remote-connections`, `managed-processes`, and `always` modes with platform-specific idle-sleep inhibition that leaves screen locking/display timeout unchanged.

### Changed

- **Settings UX**: compacted Keep Awake and Execution controls; moved advanced execution values behind a disclosure; moved command overrides, network rules, environment profile creation, and secret storage into focused modal workflows.
- **Remote Access UX**: separated MCP/OAuth and Administration Web UI configuration, made the Admin public URL the primary origin, added compact trusted-origin management, and kept Admin probe results next to the tested URL.
- **Runtime Overview**: descriptive Sleep inhibition state now uses compact status typography instead of the large numeric metric treatment.
- **Documentation**: synchronized the engineering specs with MCP protocol `2025-06-18`, the 42-tool surface, schema migrations through v10, connection continuity, independent Admin exposure, stable ngrok, keep-awake behavior, and current configuration keys.

### Fixed

- **Lease continuity**: general activity now refreshes every active workspace lease in a multi-workspace session while expired session-only leases remain expired.
- **Remembered workspace recovery**: authenticated OAuth reconnect/restart restores missing remembered workspace leases without reviving one-shot/session-only authority.
- **Admin origin security**: the MCP public URL is no longer implicitly trusted for Admin mutations, and forwarded host/proto headers cannot expand the trusted Admin origin set.

## [0.1.1] - 2026-08-25

### Added

- **CLI Version & Help Aliases**: Added `aevra -v`, `aevra --version`, and `aevra version` commands for quick version inspection without requiring configuration or credentials, and supported `aevra -h` as an alias for `aevra --help`.
- **Web UI Update Notification**: Automatically checks npm registry for newer versions; when outdated, displays a click-to-copy `npm i -g @the-long-ride/aevra@latest` command in the top bar.
- **Provider Badges in README**: Added badges for Gemini, Langdock, and Manus AI, and updated ChatGPT badge with the official OpenAI logo.

### Fixed

- **Web Dashboard Packaging**: Include `dist/apps/web` in `package.json` `files` array to ensure all React UI assets, icons, and user manual pages are included in published npm packages.
- **Static Web Path Resolution**: Anchor `staticDir` to module location via `import.meta.url` instead of caller working directory (`process.cwd()`), eliminating 404 Not Found errors when starting Aevra globally or from arbitrary directories.
- **CI Container Integration Tests**: Pre-pull Alpine container image and install Podman in CI quality gate to prevent timeouts on cold runners.

## [0.1.0] - 2026-08-25

Initial release of Aevra — a workspace-scoped local MCP execution gateway for AI web interfaces with policy, recovery, and audit controls.

### Added

- **MCP 2.0 Protocol & Native Capabilities**
  - Standard MCP protocol tools, dynamic resources (`aevra://skill/<source>/<name>`), prompts (`aevra-instructions`), and completions.
  - Closed input schemas and `outputSchema` metadata for stable public tools.
  - Native workspace search tool (`workspace_search`) with regex, multiline, case sensitivity, file glob filters, and bounded result streaming.
  - Sandboxed MCP lifecycle hooks (`lifecycle_hook_register`, `lifecycle_hook_list`, `lifecycle_hook_unregister`, `lifecycle_hook_execute`) with isolated execution environments and timeout bounds.
  - Dedicated granular capability permissions (`skills.read`, `skills.write`, `instructions.read`, `instructions.write`).
  - Path-contained `skill_write` and `instructions_write` tools preventing general filesystem write authority.
  - Multi-workspace MCP leasing and connection-scoped workspace grants.
  - Chunked `file_read` via `{offset, length}` with per-chunk hashes and `totalLength`.

- **Provider-Neutral Exposure & Gateways**
  - Unified HTTPS Public Gateway fronting internal loopback Admin and MCP listeners.
  - Multi-provider exposure support: Local loopback, Direct HTTPS with automatic TLS certificate generation, Cloudflare Access, managed ngrok tunnels, and custom external tunnels (Caddy, Tailscale Funnel, FRP, reverse SSH).
  - Reachability watchdog probe with 60-second health checks for active exposure channels.
  - OAuth 2.0 / PKCE authentication for ChatGPT and web AI clients with path-aware metadata discovery, CORS preflight on `/mcp`, JSON token support, and pairing code protection.
  - 128-bit cryptographically secure connector admission tokens (SHA-256 at rest, constant-time verification, instant revocation).
  - Token rotation (`POST /api/connectors/:id/rotate`) with a 5-minute grace window.
  - Per-IP token-bucket rate limiting on connector admission with failed-attempt counters.

- **Security & Data Isolation**
  - Multi-tier capability profiles (Minimal, Read-Only, Safe Dev, Power Dev, Full Access, Custom) with granular permission rules.
  - Central `SecurityGuard` boundary enforcing `SECRET` denial and `SENSITIVE` masking/redaction with one-time mutation approval.
  - Worker-side defense-in-depth blocking symlink and hard-link secret file bypasses.
  - Ranged file reads with multibyte UTF-8 preservation using JavaScript string offset semantics.
  - `policy.critical.alwaysConfirm` configuration forcing explicit local confirmation for critical operations.
  - Structured sanitizer using null-prototype records to neutralize `__proto__` injection.
  - Immutable hash-chained audit logging for all lifecycle and security-sensitive events.

- **Durable Process Management & Recovery**
  - Out-of-process Worker dispatcher over secure OS-local IPC (POSIX sockets / Windows named pipes).
  - Isolated host, managed-process, Docker, and Podman runtime execution environments.
  - Durable managed process lifecycle: `process_start`, `process_wait`, `process_status`, `process_logs`, and `process_stop`.
  - Named managed processes with SQLite persistence and runtime projections.
  - Detached `keep-running` process completion sidecars allowing background execution observation across helper exits.
  - Journaled change sets with rollback and recovery mechanisms.

- **React Admin Web UI**
  - Single-page Admin dashboard with clean dark theme (`admin.css`, `auth.css`) and responsive layout.
  - Mandatory `AEVRA_USERNAME` / `AEVRA_PASSWORD` authentication gate with session revocation on server restart.
  - Unified Connections management combining OAuth sessions and static Bearer connectors.
  - Interactive Runtime Overview with dedicated management modals for Managed Processes, Open Changes, Tool Activity, and Connectors.
  - Real-time MCP activity monitoring with newest-first stream, search, filtering (client, workspace, type, status), pagination, and sanitized input/output payload details.
  - Multi-workspace management with debounced server-side directory browsing and native server picker.
  - Built-in interactive User Guide with sticky navigation and tunnel configurations.
  - Shared UI components: compact 32px controls, custom Dropdown, DataTable with browser-local datetime formatting, Switch, and accessible Dialogs.

- **CLI & Tooling**
  - `aevra` CLI with commands for server lifecycle (`start`), connectors (`connectors list|create|revoke`), status (`status [--json]`), backup/restore (`backup verify|restore`), and shell completion (`completion bash|zsh|powershell`).
  - Friendly CLI error handling when credentials are unset without dumping stack traces.
  - Comprehensive quality gates and test suites across unit, contract, integration, security, React, and Playwright UI parity.
