# 09 — Configuration

**Audience:** engineers & AI agents · **Scope:** every knob in one place · **Verified against:** `0.1.1`

## Ports and listeners (fixed hosts)

| Listener       | Address                                       | Env override        |
| -------------- | --------------------------------------------- | ------------------- |
| Public Gateway | `https://localhost:47830` (binds `127.0.0.1`) | `AEVRA_PUBLIC_PORT` |
| Admin UI/API   | `https://localhost:47831` (binds `127.0.0.1`) | `AEVRA_ADMIN_PORT`  |
| Remote MCP     | `https://localhost:47832` (binds `127.0.0.1`) | `AEVRA_MCP_PORT`    |

## Environment variables

| Variable                                                                                                                                                  | Default                                          | Meaning                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `AEVRA_USERNAME`                                                                                                                                          | _(required for startup)_                         | Admin username for dashboard login                                   |
| `AEVRA_PASSWORD`                                                                                                                                          | _(required for startup)_                         | Admin password for dashboard login                                   |
| `AEVRA_STATE_DIR`                                                                                                                                         | platform dir (see [`07`](07-state-migration.md)) | state directory override                                             |
| `AEVRA_PUBLIC_PORT`                                                                                                                                       | `47830`                                          | public HTTPS gateway port                                            |
| `AEVRA_ADMIN_PORT`                                                                                                                                        | `47831`                                          | admin listener port                                                  |
| `AEVRA_MCP_PORT`                                                                                                                                          | `47832`                                          | MCP listener port                                                    |
| `AEVRA_TLS_CERT`                                                                                                                                          | managed localhost certificate                    | advanced certificate PEM override; requires `AEVRA_TLS_KEY`          |
| `AEVRA_TLS_KEY`                                                                                                                                           | managed localhost key                            | advanced private-key PEM override; requires `AEVRA_TLS_CERT`         |
| `AEVRA_TLS_CA`                                                                                                                                            | system trust / managed certificate               | optional CA PEM used by local CLI HTTPS verification with custom TLS |
| `AEVRA_CF_ISSUER`                                                                                                                                         | settings `cloudflare.issuer`                     | Access JWT issuer override                                           |
| `AEVRA_CF_AUDIENCE`                                                                                                                                       | settings `cloudflare.audience`                   | Access JWT audience override                                         |
| `AEVRA_WORKER_ENDPOINT` / `AEVRA_WORKER_SECRET` / `AEVRA_DAEMON_INSTANCE_ID` / `AEVRA_PROCESS_LOG_DIR` / `AEVRA_PROCESS_COMMAND` / `AEVRA_PROCESS_MARKER` | internal                                         | parent→Worker handshake (never user-set)                             |

## CLI (`apps/cli`)

```text
aevra start [--ui]                       foreground daemon; --ui opens the authenticated dashboard when ready
aevra ui [--logout-all]                  open authenticated dashboard / revoke admin sessions
aevra status [--json]                    display daemon status and health watchdog
aevra connectors list|create|revoke <id> manage admission connector tokens
aevra backup verify|restore <file>       verify or restore database backup
aevra service install|start|stop|restart|status
aevra completion bash|zsh|powershell     shell autocompletion
aevra --version / aevra -v               display version
aevra --help / aevra -h                  display help and usage
```

## Local TLS

Aevra never advertises a plaintext localhost endpoint. With no TLS override it persists a localhost certificate under the state directory with SANs for `localhost`, `127.0.0.1`, and `::1`, and attempts current-user trust installation. Windows uses the CurrentUser certificate stores; macOS uses the user login keychain; Linux attempts the user's NSS database when `certutil` is available. Custom certificate/key overrides are never silently downgraded if invalid.

## Timings (defaults, code-level)

Lease idle `30 min` · approval fast-wait `20 s` · ticket lifetime `5 min` (HIGH `2 min`, CRITICAL `60 s`) · JWKS cache `5 min` · connector `last_used_at` write throttle `1/min`.

## Background service

Windows: current-user Scheduled Task at logon · Linux: `systemd --user` · macOS: `~/Library/LaunchAgents`. No admin/root elevation. Installers in `installers/` mirror this.

## Cloudflare settings keys (SQLite `settings`)

`cloudflare.config` `{issuer,audience,hostname,tunnelId}` · `cloudflare.ownership` `managed|external` · plus execution/policy keys set via Web UI. Managed mode: Aevra owns the `cloudflared` child and restarts it with backoff; external mode: never touched.

**Boundaries:** what the values _do_ — see the referenced specs.

**Related:** [`07-state-migration`](07-state-migration.md) · [`../user-manual/10-service`](../user-manual/10-service.md)

**Next →** back to [`README`](README.md) · manual: [`../user-manual/README`](../user-manual/README.md)
