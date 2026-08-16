# 01 — System Overview

**Audience:** engineers & AI agents · **Scope:** the whole product in one view · **Verified against:** `0.1.0`

Aevra is a **local, workspace-scoped MCP execution gateway**. An AI web client (Claude.ai, ChatGPT, Gemini CLI, anything MCP-capable) connects over HTTPS; Aevra decides what that client may do, and an isolated Worker does it.

## The two planes & Public Gateway

```text
Internet / AI client MCP / Admin Browser
        │
HTTPS Public Gateway (127.0.0.1:47830)
(Direct HTTPS / Local / Cloudflare / ngrok / Caddy / Tailscale / FRP / SSH)
        │
 ┌──────┴─────────────────────────────────┐
 │                                        │
127.0.0.1:47832                          127.0.0.1:47831
MCP data plane ── Aevra Core Daemon     Admin control plane ── React Web UI
(policy · sessions · approvals · audit)  (credentials auth · management modals)
        │
named pipe / unix socket
        │
Execution Worker (filesystem · git · commands · sandbox · processes · hooks)
```

Internal MCP and Admin listeners remain loopback-only. The unified Public Gateway coordinates ingress with support for provider-neutral exposure modes.

## The central invariant

> **The Core decides authority. The Worker executes only the exact authority it receives.**

Everything else in these specs is an elaboration of that sentence.

## Components

| Component    | Location                            | Responsibility                                        |
| ------------ | ----------------------------------- | ----------------------------------------------------- |
| CLI          | `apps/cli`                          | `aevra start/ui/setup/service/connectors/status`      |
| Core Daemon  | `apps/core`                         | sessions, leases, policy, approvals, audit, gateway   |
| MCP ingress  | `apps/core/src/mcp/server.ts`       | admission (OAuth 2.0 / connector token), JSON-RPC     |
| Admin server | `apps/core/src/admin/`              | React Web UI API, password auth, runtime projections  |
| Worker       | `apps/worker` + `packages/executor` | file/git/command/process execution, sandboxing, hooks |
| Store        | `packages/store`                    | SQLite repositories (`node:sqlite`, WAL)              |
| Web UI       | `apps/web-react`                    | React 19 single-page dashboard with dark theme        |

## Dependency boundaries (enforced by tests)

- Core authorizes operations but never performs them directly.
- MCP tool code (`packages/mcp-tools`) never imports Worker executors.
- The Web UI never imports Worker/IPC code.
- The Worker never imports Core policy, store, or admin code.

## Repository layout

`apps/` (cli, core, web-react, worker) · `packages/` (executor, ipc, mcp-tools, notifications, protocol, secrets, security, store) · `installers/` · `docs/` · `scripts/`.

**Boundaries:** no install instructions (manual `01`), no protocol detail (`03`), no security rationale (`02`).

**Related:** [`02-security-model`](02-security-model.md) · [`../user-manual/02-first-start`](../user-manual/02-first-start.md)

**Next →** [`02-security-model`](02-security-model.md)
