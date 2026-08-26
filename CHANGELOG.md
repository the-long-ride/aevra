# Changelog

All notable changes to this project are documented here.

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
