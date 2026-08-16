# Changelog

All notable changes to this project are documented here.

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
