# Aevra

<div align="center">

<img src="https://raw.githubusercontent.com/the-long-ride/aevra/main/assets/aevra-logo.png" alt="Aevra Logo" width="256" />

[![npm version](https://img.shields.io/npm/v/@the-long-ride/aevra.svg?style=flat-square&color=ffffff&labelColor=000000&logo=npm&logoColor=ffffff)](https://www.npmjs.com/package/@the-long-ride/aevra)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.5.0-ffffff?style=flat-square&labelColor=000000&logo=node.js&logoColor=ffffff)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-ffffff?style=flat-square&labelColor=000000)](https://github.com/the-long-ride/aevra)
[![MCP](https://img.shields.io/badge/MCP-2.0-ffffff?style=flat-square&labelColor=000000)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-ffffff?style=flat-square&labelColor=000000)](https://github.com/the-long-ride/aevra/blob/main/LICENSE)

[![ChatGPT](https://img.shields.io/badge/ChatGPT-%E2%9C%93-ffffff?style=flat-square&labelColor=000000&logo=openai&logoColor=ffffff)](https://chat.openai.com)
[![Claude](https://img.shields.io/badge/Claude-%E2%9C%93-ffffff?style=flat-square&labelColor=000000&logo=anthropic&logoColor=ffffff)](https://claude.ai)
[![Grok](https://img.shields.io/badge/Grok-%E2%9C%93-ffffff?style=flat-square&labelColor=000000&logo=x&logoColor=ffffff)](https://grok.com)

</div>

**Aevra** is a secure bridge that lets AI assistants like ChatGPT, Claude.ai, and Grok actually do things on your computer — read and write files, run commands, manage code, search your workspace, and interact with external tools — all while keeping you in full control of what they can and cannot touch.

Think of it as a smart gatekeeper that sits on your machine. When an AI assistant wants to take an action, Aevra checks whether it is allowed, asks for your approval when needed, records everything it does, and blocks anything that looks dangerous. You decide the rules; the AI follows them.

It works with any AI tool that supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) standard, runs on Windows, macOS, and Linux, and can be reached securely from anywhere — your local network, a public tunnel, or behind a firewall.

```text
Internet / AI Web Client / Admin Browser
        │
HTTPS Public Gateway (127.0.0.1:47830)
(Direct HTTPS / Local / Cloudflare / ngrok / Caddy / Tailscale / FRP / SSH)
        │
 ┌──────┴─────────────────────────────────┐
 │                                        │
127.0.0.1:47832                          127.0.0.1:47831
MCP Data Plane ── Aevra Core Daemon      Admin Control Plane ── React Web UI
(policy · sessions · approvals · audit)  (credentials auth · management modals)
        │
named pipe / unix socket (IPC)
        │
Execution Worker (filesystem · git · commands · sandbox · processes · hooks)
```

> **The Central Invariant:** The Core decides authority. The Worker executes only the exact authority it receives.

---

## What Makes Aevra Different?

- **Fast & Lightweight**: Pure native Node.js implementation with zero heavy runtime overhead, instant JSON-RPC 2.0 streaming, and multi-threaded parallel regex search (`workspace_search`).
- **Zero-Trust Security & Data Isolation**: Central `SecurityGuard` resource boundary with automatic `SECRET` denial, `SENSITIVE` data masking, real-time DLP redaction, and in-depth protection against symlink and hard-link alias attacks.
- **Native Cross-Platform Support**: First-class citizen on **Windows** (Scheduled Tasks, named pipes, DPAPI), **Linux** (`systemd --user`, unix domain sockets, Secret Service), and **macOS** (`LaunchAgents`, Keychain).
- **Granular Control & Step-Up Approvals**: Multi-tier capability profiles (Minimal, Read-Only, Safe Dev, Power Dev, Full Access, Custom), human-in-the-loop interactive approvals, and `policy.critical.alwaysConfirm` for sensitive operations.
- **Durable Process Lifecycle & Recovery**: Named managed background processes (`process_start`, `process_wait`, `process_logs`) with detached completion sidecars, journaled change sets with rollback, and safe 3-way auto-merging for non-conflicting concurrent edits.
- **Provider-Neutral Ingress**: Run directly via built-in self-signed Direct HTTPS, Cloudflare Access tunnels, managed ngrok, Caddy, Tailscale Funnel, FRP, or reverse SSH with full OAuth 2.0 / PKCE authentication.

---

## Core Features

- **40 Stable MCP Tools**: Comprehensive toolset covering workspace operations, file mutations, git actions, terminal commands, managed processes, change set rollbacks, lifecycle hooks, and native workspace search.
- **Dynamic Resources & Instruction Prompts**: Serves context files seamlessly via MCP resources (`aevra://skill/<source>/<name>`) and instruction prompts (`aevra-instructions` parsed from `AGENTS.md` / `CLAUDE.md`).
- **React 19 Admin Dashboard**: Single-page dark theme dashboard featuring real-time MCP activity monitoring with sanitized input/output payload inspection, interactive runtime modals, and debounced workspace directory browsing.
- **Out-of-Process Worker Sandbox**: Execution worker runs in an isolated child process communicating over authenticated local IPC, with Docker and Podman container sandboxing support.

---

## Quick Onboard Installation

Install Aevra globally via npm and start the gateway on your operating system:

### Windows (PowerShell)

```powershell
# 1. Install Aevra globally
npm install -g @the-long-ride/aevra@latest

## Choose 2.1 or 2.2:

# 2.1 Configure admin credentials for User scope - Recommend for future use with only aevra start
[System.Environment]::SetEnvironmentVariable('AEVRA_USERNAME', 'admin', 'User')
[System.Environment]::SetEnvironmentVariable('AEVRA_PASSWORD', 'YourSecurePassword', 'User')

# 2.2. Apply to current session only
# $env:AEVRA_USERNAME = 'admin'
# $env:AEVRA_PASSWORD = 'YourSecurePassword'

# Start aevra with dashboard in browser
aevra start --ui
```

### macOS & Linux (zsh / bash)

```bash
# 1. Install Aevra globally
npm install -g @the-long-ride/aevra@latest

# 2. Configure admin credentials and launch daemon with Web UI
export AEVRA_USERNAME="admin"
export AEVRA_PASSWORD="YourSecurePassword"
aevra start --ui
```

_(Optional)_ Run Aevra automatically as a user-level background service:

```bash
aevra service install
aevra service start
```

---

## Quick Connect Guide

Aevra exposes a standard MCP endpoint (`/mcp`) that can be accessed either **directly over HTTPS** (e.g. `https://localhost:47830/mcp` or direct IP/domain) or **exposed to the internet through a tunnel** (Cloudflare Tunnel, ngrok, Tailscale Funnel, Caddy, FRP, reverse SSH).

### 1. Connect ChatGPT (Custom Plugin / Action)

1. In ChatGPT, create a new Custom Plugin / Action:
   - **Name**: `Aevra` (or any custom name)
   - **Server URL**: `https://<your-aevra-host>/mcp` (e.g. your tunnel or public URL)
   - **Authentication**: `OAuth`
2. ChatGPT initiates the OAuth 2.0 PKCE discovery flow; open your local Aevra Web UI (`https://localhost:47831`) and click **Allow** on the pairing request.
3. Under ChatGPT plugin / action settings, grant **Permission for Plugins -> Allow all actions** so commands and tool calls execute through Aevra without recurring client confirmation dialogs.

### 2. Connect Claude.ai, Grok, etc. & Other MCP Clients (Custom Connector)

Claude example:

1. Open Claude and navigate to **Customize** or your account **Settings**, then select **Connectors**.
   - **Name**: `Aevra` (or any custom name)
   - **Server URL**: `https://<your-aevra-host>/mcp` (e.g. your tunnel or public URL)
   - **Authentication**: `OAuth`
2. Other steps are familiar with ChatGPT.

---

## Tips

### Security

- **Rotate credentials regularly**: Update `AEVRA_USERNAME` / `AEVRA_PASSWORD` via `[System.Environment]::SetEnvironmentVariable` (Windows) or update the export in your shell profile (macOS / Linux) and restart Aevra.
- **Scope tunnel exposure**: Expose only the `/mcp` path through your tunnel (e.g. `cloudflared tunnel --url https://localhost:47830`). Never expose the admin control plane port (47831) to the public internet.
- **Use capability profiles**: Assign the least-privilege profile per connector in the Web UI. Prefer `Read-Only` or `Safe Dev` for AI web clients and reserve `Full Access` for trusted local sessions.
- **Audit regularly**: Review the tamper-evident audit log in the Web UI (`Activity` tab) to spot unexpected tool calls or policy overrides.

### Performance

- **Scope workspace search**: Use `workspace_search` with explicit `include` / `exclude` glob patterns. Unbounded searches on large monorepos will be slower — pin to the relevant subdirectory.
- **Parallel managed processes**: Prefer `process_start` + `process_wait` for long-running builds or test suites instead of blocking terminal commands. Aevra tracks them across reconnects.
- **Change set rollbacks**: Use journaled change sets for multi-file edits. If a mid-task error occurs, a single rollback call restores all files atomically without manual undo.
- **Keep Aevra as a background service**: Run `aevra service install && aevra service start` so the gateway survives reboots and reconnects from AI clients automatically.

### Remote Working through ChatGPT & Claude.ai

- **Generate images remotely**: Ask ChatGPT or Claude to call the `workspace_write` tool to save AI-generated image data directly into your local project folder or stage assets for a pipeline.
- **Automate research and reporting**: Instruct the AI to run `workspace_search` across your notes or data directories, synthesize findings, and write a structured report to a local file — a full research loop without leaving chat.
- **Manage social media and content pipelines**: Connect Aevra to MCP servers that wrap social media APIs or content schedulers. The AI can draft posts, read engagement metrics via `terminal_exec`, and write scheduled content files — all orchestrated from a single chat session.
- **Run multi-step automation as agents**: Chain `workspace_search`, `terminal_exec`, `file_write`, and `git_commit` in one prompt. The AI acts as an autonomous agent that finds, processes, writes, and records results end-to-end with no manual handoffs.
- **Collaborate on code**: Point ChatGPT or Claude at your local repository through Aevra. The AI can read files, run tests via `terminal_exec`, apply edits, and commit — all in one conversation thread.
- **Office coworking**: Use Aevra to let AI clients read, draft, and write local documents (`.md`, `.docx` via scripts, `.csv`). Automate repetitive tasks such as report generation, data summarization, or template filling directly from chat.
- **Multi-client workflows**: Connect ChatGPT for drafting and Claude.ai for review simultaneously. Each connector gets its own capability profile so you control exactly what each client can touch.

### Hooks

- **Pre- and post-tool hooks**: Define `hooks.pre` and `hooks.post` entries in your workspace `aevra.config.json` to run scripts automatically before or after specific MCP tool calls — useful for linting before a commit, sending a notification after a file write, or triggering a build on code change.
- **Abort dangerous operations**: A `pre` hook that exits non-zero cancels the tool call entirely. Use this to block destructive commands (`rm -rf`, `DROP TABLE`) in specific directories or enforce custom policy rules beyond Aevra's built-in capability profiles.
- **Chain external services**: Use `post` hooks to forward tool results to external services — post a Slack message when a report is generated, sync files to cloud storage after a write, or trigger a CI pipeline after a git commit.
- **Per-workspace hook isolation**: Hooks are scoped to the workspace config file, so different projects can have different automation rules without affecting one another.

---

## Documentation & Guidelines

- **[Installation & Development Guideline](https://github.com/the-long-ride/aevra/blob/main/GUIDELINE.md)**: Building from source, development scripts, test suites, architecture boundaries, and troubleshooting.
- **[Technical Specifications](https://github.com/the-long-ride/aevra/blob/main/docs/specs/README.md)**: In-depth design documents for engineers and AI coding agents.
- **[User Manual](https://github.com/the-long-ride/aevra/blob/main/docs/user-manual/README.md)**: 2-minute modular guides for tunnels, connectors, workspaces, permissions, and service setups.
- **[Changelog](https://github.com/the-long-ride/aevra/blob/main/CHANGELOG.md)**: Release history and version notes.

---

## Companion

[AI Chatweb Supporter](https://github.com/the-long-ride/ai-chatweb-supporter) is a companion Chromium extension that enhances ChatGPT, Claude, and Grok directly in the browser — improving usability and productivity when working alongside Aevra.

---

## License

MIT (c) [Aevra Contributors](https://github.com/the-long-ride/aevra/blob/main/LICENSE)
