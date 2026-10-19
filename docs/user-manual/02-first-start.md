# First start

Set the mandatory Admin credentials in the environment, then start Aevra:

```powershell
$env:AEVRA_USERNAME = 'admin'
$env:AEVRA_PASSWORD = '<choose-a-password>'
aevra start --ui
```

Aevra validates the credentials before opening listeners, starts the internal Admin and MCP services on loopback, starts the unified HTTPS Public Gateway, and opens the Aevra login page. Keep the terminal running unless Aevra is installed as a background service.

## Custom ports

If another process occupies a default port, choose a different block:

```sh
aevra start --ui --basePort=50000
```

This starts the gateway on `50000`, UI/admin and extension pairing on `50001`,
internal MCP on `50002`, and extension WebSocket on `50003`. The default block
is `47830` through `47833`. Enter the UI/pairing port (`50001` in this example)
when pairing the browser extension.

Alternatively, change any subset of the listeners:

```sh
aevra start --ui --gateway-port=50000 --ui-port=51000 --mcp-port=52000 --ws-port=53000
aevra start --ui --gp=50000 --up=51000 --mp=52000 --wp=53000
```

Long names and aliases behave identically; `--flag value` also works. Explicit
ports override the corresponding environment settings for this invocation.
Omitted individual ports retain their environment settings or defaults. Base and
individual modes cannot be combined. Ports must be distinct integers from `1`
through `65535`; a base cannot exceed `65532`. Occupied ports are reported rather
than silently replaced. Startup output shows the actual addresses, and subsequent
CLI commands such as `aevra ui`, `aevra status`, and agent installation follow the
running instance in the same state directory.

`aevra service install`, `start`, and `restart` accept the same port options.
Installed services retain the selected arguments for future starts. An explicit
selection replaces the previously installed selection; omitted individual flags
then use normal environment/default resolution. Starting or restarting without
port flags preserves the installed selection. Use `service restart` to change a
running service's ports. Foreground overrides do not rewrite saved settings.

## Startup output

Once startup is ready, Aevra renders Core readiness and the local service endpoints as an aligned table. With the default local ports and `--ui`, the status portion looks like this:

```text
┌───────────┬─────────────────────────────┐
│ Service   │ Value                       │
├───────────┼─────────────────────────────┤
│ Core      │ ready                       │
│ MCP       │ https://localhost:47832/mcp │
│ Dashboard │ https://localhost:47831     │
└───────────┴─────────────────────────────┘

[aevra] Opening https://localhost:47831/
[aevra] Press Ctrl+C to stop Aevra.
```

The table expands automatically when configured URLs are longer. The `Opening` line appears only when Aevra launches the UI automatically. The Ctrl+C hint is always printed after the table and any UI-launch message, so it is the final startup line.

`aevra ui` can reopen the login page later. It does not create or bypass an authenticated Admin session.

The Web UI supports multiple independent signed-in sessions. All persisted Admin sessions are invalidated whenever the Core starts, so a restart requires signing in again.

On first run, complete **Onboarding** from the dashboard. Configure Remote Access, connect an AI client, register a workspace, and try a bounded operation.

Local exposure keeps the Public Gateway and Admin UI loopback-only. Remote MCP/OAuth exposure uses the configured public MCP URL. If you also need remote Admin access, configure an independent Admin public URL and explicit trusted Admin origins. Publishing the MCP endpoint never implicitly trusts that origin for Admin login or mutations.
