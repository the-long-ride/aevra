# 12 — Custom startup ports

Status: implemented in Aevra **1.3.1**. This contract describes current behavior.

## Listener selection

Hosts and protocols retain their existing configuration. Without CLI port options,
the environment/default resolution is unchanged.

| Listener                       | Default | Base offset | Individual flag  | Alias  |
| ------------------------------ | ------: | ----------: | ---------------- | ------ |
| Public gateway                 |   47830 |           0 | `--gateway-port` | `--gp` |
| UI/admin and extension pairing |   47831 |           1 | `--ui-port`      | `--up` |
| Internal MCP                   |   47832 |           2 | `--mcp-port`     | `--mp` |
| Extension WebSocket            |   47833 |           3 | `--ws-port`      | `--wp` |

```sh
aevra start --ui --basePort=50000
aevra start --ui --gp=50000 --up=51000 --mp=52000 --wp=53000
```

`--basePort=N` selects all four listeners. Individual mode selects any subset;
unselected listeners keep their environment values or defaults. Both `--flag=N`
and `--flag N` work. The two modes cannot be mixed. Repeated logical options,
including a long flag followed by its alias, are rejected.

Values must contain decimal digits only and resolve to integers in `1..65535`.
The base must be at most `65532`; derived ports cannot overflow. All four resolved
ports must be distinct. CLI selections override corresponding environment values
without changing the parent environment or saved settings.

## Runtime propagation and failure

The resolved WebSocket port reaches the execution worker, pairing response and
origin policy. The extension pairs through the selected UI/admin port and receives
the selected WebSocket URL. Startup exposes the actual gateway/admin/MCP URLs.
An occupied WebSocket listener fails startup with port/error guidance and releases
the other runtime resources. Other bind failures also fail startup; there is no
automatic search for another port.

Foreground startup publishes an atomic `listeners.json` record in the configured
state directory after readiness. It contains the PID, owner ID and actual ports,
without credentials. Later UI/status/agent-management CLI commands use a valid
record with a live PID; malformed/stale records fall back to normal configuration.
Shutdown removes only the record owned by that invocation. Readiness failure
closes the runtime. The record is discovery state, not a saved port preference.

## Installed service

`aevra service install`, `start`, and `restart` accept both modes. Port flags are
retained in the Windows Scheduled Task, systemd user unit or macOS LaunchAgent.
Explicit selections replace the installed selection; omitted individual values
then resolve normally. A start/restart without flags preserves installed arguments.
An explicit start against an already running service asks the user to restart;
stop/status reject startup flags.

## Sibling products

Standalone Browser uses `--basePort=N` for pairing/settings N, MCP N+1 and WebSocket
N+2, or `--ui-port/--up`, `--mcp-port/--mp`, `--ws-port/--wp`. Its base maximum is
`65533`; CDP's existing `--port` still selects the controlled browser's debugging
port. Desktop GUI uses `--port/--p` for its one HTTP listener, retains the HTTP
enable switch, and does not persist the override. See each repository's current
specification for its background startup and reload behavior.

## Verification

Behavioral regressions cover both syntaxes, aliases, unchanged configuration,
validation, actual child WebSocket binding, pairing/origin consistency, discovery
cleanup, four real listeners, occupied-port rollback and OS service definitions.
Full-suite environment restrictions are recorded in the task verification report;
this contract does not imply cross-platform native service acceptance.

Related: [configuration](09-configuration.md), [first start](../user-manual/02-first-start.md),
[service operation](../user-manual/12-service.md).
