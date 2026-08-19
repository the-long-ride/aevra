# 01 — System Overview

**Audience:** engineers & AI agents · **Scope:** the whole product in one view · **Verified against:** `0.4.0`

Aevra is a **local, workspace-scoped MCP execution gateway**. An AI web client (Claude.ai, ChatGPT, Gemini CLI, anything MCP-capable) connects over HTTPS; Aevra decides what that client may do, and an isolated Worker does it.

## The two planes

```text
Internet / AI client MCP
        │
Cloudflare Access + Tunnel  (or a per-connector URL /mcp/<token>)
        │
127.0.0.1:47832   MCP data plane ── Aevra Core Daemon
        │                              (policy · sessions · approvals · audit)
named pipe / unix socket
        │
Execution Worker (filesystem · git · commands · sandbox · processes)

127.0.0.1:47831   Admin control plane ── Web UI (localhost only)
```

Both listeners are loopback-only. Only port `47832` is ever tunneled.

## The central invariant

> **The Core decides authority. The Worker executes only the exact authority it receives.**

Everything else in these specs is an elaboration of that sentence.

## Components

| Component    | Location                            | Responsibility                                        |
| ------------ | ----------------------------------- | ----------------------------------------------------- |
| CLI          | `apps/cli`                          | `aevra start/ui/setup/service`                        |
| Core Daemon  | `apps/core`                         | sessions, leases, policy, approvals, audit, migration |
| MCP ingress  | `apps/core/src/mcp/server.ts`       | admission (Access JWT or connector token), JSON-RPC   |
| Admin server | `apps/core/src/admin/`              | localhost Web UI API, bootstrap sessions              |
| Worker       | `apps/worker` + `packages/executor` | file/git/command/process execution, sandboxing        |
| Store        | `packages/store`                    | SQLite repositories (`node:sqlite`, WAL)              |
| Web UI       | `apps/web`                          | vanilla-JS dashboard served by the admin plane        |

## Dependency boundaries (enforced by tests)

- Core authorizes operations but never performs them directly.
- MCP tool code (`packages/mcp-tools`) never imports Worker executors.
- The Web UI never imports Worker/IPC code.
- The Worker never imports Core policy, store, or admin code.

## Repository layout

`apps/` (cli, core, web, worker) · `packages/` (executor, ipc, mcp-tools, notifications, protocol, secrets, security, store) · `installers/` · `docs/` · `scripts/`.

**Boundaries:** no install instructions (manual `01`), no protocol detail (`03`), no security rationale (`02`).

**Related:** [`02-security-model`](02-security-model.md) · [`../user-manual/02-start`](../user-manual/02-start.md)

**Next →** [`02-security-model`](02-security-model.md)
