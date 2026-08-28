# 01 — System Overview

**Audience:** engineers & AI agents · **Scope:** the whole product in one view · **Verified against:** `0.1.3`

Aevra is a **local, workspace-scoped MCP execution gateway**. An AI web client (Claude.ai, ChatGPT, Gemini CLI, anything MCP-capable) connects over HTTPS; Aevra decides what that client may do, and an isolated Worker does it.

## The two planes & public endpoints

```text
AI MCP client --HTTPS--> publicUrl ---------------------> Public Gateway :47830 (HTTPS/HTTP) --> MCP :47832 (HTTPS)
Admin browser  --HTTPS--> adminPublicUrl (optional) ---> Admin UI/API :47831 (HTTPS)

Core policy / sessions / approvals / audit --OS-local IPC--> Execution Worker
```

All internal listeners bind to loopback. `ExposureConfig.publicUrl` is the canonical MCP/OAuth public endpoint. The local gateway on `:47830` supports configurable `localProtocol` (`https` default, or `http` for local loopback / behind reverse proxies), while internal Admin (`:47831`) and MCP (`:47832`) listeners strictly enforce loopback HTTPS. The Admin UI may be published independently at `adminPublicUrl`; its exact HTTPS origin and any explicit `trustedAdminOrigins` are trusted for Admin browser requests. The MCP public origin is not implicitly trusted for Admin login or mutations. Provider-neutral exposure supports Local, Direct HTTPS, Cloudflare, ngrok, and externally managed tunnels.

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
