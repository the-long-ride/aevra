# 09 — Configuration

**Audience:** engineers & AI agents · **Scope:** every supported runtime knob in one place · **Verified against:** `0.1.2`

## Ports and listeners (fixed hosts)

| Listener       | Address                                       | Env override        |
| -------------- | --------------------------------------------- | ------------------- |
| Public Gateway | `https://localhost:47830` (binds `127.0.0.1`) | `AEVRA_PUBLIC_PORT` |
| Admin UI/API   | `https://localhost:47831` (binds `127.0.0.1`) | `AEVRA_ADMIN_PORT`  |
| Remote MCP     | `https://localhost:47832` (binds `127.0.0.1`) | `AEVRA_MCP_PORT`    |

## Environment variables

| Variable                                                                                      | Default                       | Meaning                                                                         |
| --------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| `AEVRA_USERNAME`                                                                              | required                      | Admin username                                                                  |
| `AEVRA_PASSWORD`                                                                              | required                      | Admin password                                                                  |
| `AEVRA_STATE_DIR`                                                                             | platform state dir            | State directory override                                                        |
| `AEVRA_PUBLIC_PORT`                                                                           | `47830`                       | Public HTTPS gateway port                                                       |
| `AEVRA_ADMIN_PORT`                                                                            | `47831`                       | Admin listener port                                                             |
| `AEVRA_MCP_PORT`                                                                              | `47832`                       | MCP listener port                                                               |
| `AEVRA_TLS_CERT`                                                                              | managed localhost certificate | Advanced certificate PEM override; requires `AEVRA_TLS_KEY`                     |
| `AEVRA_TLS_KEY`                                                                               | managed localhost key         | Advanced private-key PEM override; requires `AEVRA_TLS_CERT`                    |
| `AEVRA_TLS_CA`                                                                                | system/managed trust          | Optional CA PEM used by local CLI HTTPS verification                            |
| `AEVRA_CF_ISSUER`                                                                             | saved Cloudflare issuer       | Cloudflare Access JWT issuer override                                           |
| `AEVRA_CF_AUDIENCE`                                                                           | saved Cloudflare audience     | Cloudflare Access audience override                                             |
| `AEVRA_OAUTH_ACCESS_TOKEN_TTL_MS`                                                             | 1 hour                        | OAuth access-token lifetime                                                     |
| `AEVRA_OAUTH_REFRESH_TOKEN_TTL_MS`                                                            | 30 days                       | Absolute refresh-family lifetime; must exceed access-token TTL                  |
| `AEVRA_CONNECTION_RECONNECT_GRACE_MS`                                                         | 15 minutes                    | Grace after OAuth transport detach; `0` disables grace                          |
| `AEVRA_ADMIN_PUBLIC_URL`                                                                      | unset                         | Bootstrap/canonical remote Admin HTTPS URL when no saved Admin URL overrides it |
| `AEVRA_TRUSTED_ADMIN_ORIGINS`                                                                 | empty                         | Comma-separated additional exact HTTPS Admin origins; additive to saved trust   |
| `AEVRA_WORKER_ENDPOINT`, `AEVRA_WORKER_SECRET`, `AEVRA_DAEMON_INSTANCE_ID`, `AEVRA_PROCESS_*` | internal                      | Core/Worker and detached-process handshake; never user-set                      |

Remote Admin origins are normalized to exact HTTPS origins. Wildcards and embedded credentials are rejected. `Forwarded` / `X-Forwarded-*` headers never establish Admin trust. The MCP `publicUrl` is not automatically trusted as an Admin origin.

## Persisted settings

- `exposure.config`: provider (`local|direct|cloudflare|ngrok|external`), canonical MCP/OAuth `publicUrl`, optional independent `adminPublicUrl`, additional `trustedAdminOrigins`, and provider-specific fields.
- Managed ngrok supports `domainMode: automatic|stable`; stable mode requires the configured public URL and refuses a discovered-domain mismatch instead of silently falling back.
- `execution.settings`: sandbox backend (`auto|docker|podman|native`), cache policy, workspace drain timeout (default 60,000 ms), and parallel search limit (default 8, clamped 1..32).
- `power.keepAwake`: `off|remote-connections|managed-processes|always`; default `remote-connections`.
- Command-family overrides, network rules, environment profiles, secret references, hooks, permissions, and workspace mappings are managed through their dedicated Admin APIs/UI.

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

Aevra never advertises a plaintext localhost endpoint. With no TLS override it persists a localhost certificate under the state directory with SANs for `localhost`, `127.0.0.1`, and `::1`, and attempts current-user trust installation. Windows uses CurrentUser certificate stores; macOS uses the user login keychain; Linux attempts the user's NSS database when `certutil` is available. Custom certificate/key overrides are never silently downgraded if invalid. Direct public exposure requires a publicly trusted certificate; the managed localhost certificate is not accepted for public Direct mode.

## Timings (defaults)

Lease idle `30 min` · reconnect grace `15 min` · approval fast-wait `20 s` · ticket lifetime `5 min` (HIGH `2 min`, CRITICAL `60 s`) · OAuth access token `1 h` · OAuth refresh family `30 d` · JWKS cache `5 min` · connector `last_used_at` write throttle `1/min` · keep-awake reevaluation `5 s`.

## Background service

Windows: current-user Scheduled Task at logon · Linux: `systemd --user` · macOS: `~/Library/LaunchAgents`. No admin/root elevation. Installers in `installers/` mirror this.

**Boundaries:** what the values _do_ — see the referenced specs.

**Related:** [`07-state-migration`](07-state-migration.md) · [`../user-manual/12-service`](../user-manual/12-service.md)

**Next →** back to [`README`](README.md) · manual: [`../user-manual/README`](../user-manual/README.md)
