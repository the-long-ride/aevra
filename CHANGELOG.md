# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is semantic.

## [Unreleased]

### Added

- Durable managed-process terminal status with `process_status` and bounded `process_wait`, including exit code, signal, finish time, duration, and terminal metadata in process lists/logs.
- Detached `keep-running` process completion sidecars so Aevra can observe the child's final result after the helper exits.
- MCP `outputSchema` metadata for stable public tools plus closed input schemas for the stable tool surface.
- Dedicated `skills.read`, `skills.write`, `instructions.read`, and `instructions.write` capabilities.
- `skill_write` and `instructions_write` tools with bounded, path-contained targets rather than general filesystem write authority.
- Shared OpenCode-style React switch control used by permission capability choices.

### Changed

- Built-in capability profiles refresh their built-in definitions on startup so upgrades receive new read capabilities without rewriting custom profiles.
- Permission UI exposes skill/instruction read/write capabilities as switches.
- Long-running command guidance now uses `process_start` → `process_wait`/`process_status`/`process_logs` instead of relying on one long MCP request.

## [0.5.0] — 2026-08-17

Roadmap burn-down: every P0/P1 item and nearly all P2/P3 items, executed and verified in one pass.

### Added

- Per-IP token-bucket rate limiting on connector admission (`429 {"error":"rate_limited"}` when exhausted; failed-attempt counters surfaced in admin status and dashboard banner). (R5)
- Security audit events for connector lifecycle: create / revoke / rotate (class `security`, hash-chained). (R2)
- **Connector policy bindings** — optional per-connector default workspace, capability-profile cap, and expiry TTL; admission stays separate from authority (bindings are defaults and ceilings enforced at lease time). Migration v4. (R9)
- **Token rotation** — `POST /api/connectors/:id/rotate` issues a fresh token; the old one stays valid during a 5-minute grace window, then dies. (R10)
- `aevra connectors list|create <name>|revoke <id>` and `aevra status [--json]` and `aevra backup verify <file>|restore <file> [--yes]` CLI commands; shell completion via `aevra completion bash|zsh|powershell`. (R7, R14, R19, R23)
- `skills_list` server-side `query`/`limit`/`offset` with `total` echo. (R12)
- **MCP resources & prompts surfaces** — skills exposed as `aevra://skill/<source>/<name>` resources, merged AGENTS.md as the `aevra-instructions` prompt; advertised in `initialize` capabilities, inert for clients that never ask. (R17)
- **Usage metrics** — per-tool call counts and latencies (`GET /api/metrics`, dashboard card). (R18)
- **Tunnel health watchdog** — 60 s reachability probe; status in `aevra status --json` and admin health. (R20)
- Chunked `file_read` via `{offset, length}` with per-chunk hash and `totalLength`. (R21)
- `policy.critical.alwaysConfirm` setting — CRITICAL operations always route to local approval even under persistent allow rules. (R22)
- Dashboard: failed-attempt banner, audit list with actor/operation filter, tool-usage card; light theme via `prefers-color-scheme`. (R13, R25)
- Example skills pack under `examples/skills/` (workspace tour, release checklist); docs versioning stamp; `CHANGELOG.md` ships in the npm package. (R24, R26)

### Fixed

- `npm test` is fully green on Windows: the macOS LaunchAgent service test is platform-agnostic, and the two process-log tests poll with a deadline instead of fixed sleeps. (R1)
- `instructions_read` rejects instruction files larger than 256 KB (`SKILL_FILE_TOO_LARGE`) instead of reading them whole. (R3)
- `serverInfo.version` comes from a single source (`apps/core/src/version.ts`), enforced against `package.json` by a test. (R4)

## [0.4.0] — 2026-08-17

The product formerly known as Linker ("chatgpt-opencode-linker") becomes **Aevra**.

### Added

- **Connector URLs** — per-client admission at `/mcp/<token>`: 128-bit tokens (SHA-256 at rest, constant-time verification, uniform 401s, instant revocation), managed from the dashboard's Connectors page or the admin API. Makes Claude.ai, Gemini CLI, and any MCP-capable web AI first-class clients without login flows.
- **Skills & instructions over MCP** — `skills_list`, `skill_read`, `instructions_read` serve `~/.agents/skills` + workspace `.agents/skills` and AGENTS.md/CLAUDE.md (frontmatter preview capped at 4 KB, per-file 256 KB cap, traversal-guarded, secret-masked).
- Documentation set: `docs/specs` (engineer/AI-agent specs), `docs/user-manual` (2-minute how-tos), roadmap.

### Changed

- CLI `linker` → `aevra`; package `chatgpt-opencode-linker` → `aevra`; env vars `LINKER_*` → `AEVRA_*`; state dir `…/Linker` → `…/Aevra`; MCP tool `linker_status` → `aevra_status`; local control header `x-aevra-control`; admin cookie `aevra_admin`.
- Schema v3: `connectors` table.
- Web UI: Connectors page with one-time token display; Cloudflare guidance that Access must cover `/mcp` only.

## [0.3.0] — 2026-08-16

Linker as a workspace-scoped remote MCP execution gateway for ChatGPT: Cloudflare Access admission, capability profiles, permission rules, approvals, journaled change sets with recovery, managed processes, DLP, hash-chained audit, safe mode, localhost Web UI control plane for workspace/mount registration, durable process control, and recovery.
