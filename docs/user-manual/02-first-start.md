# First start

Set the mandatory Admin credentials in the environment, then start Aevra:

```powershell
$env:AEVRA_USERNAME = 'admin'
$env:AEVRA_PASSWORD = '<choose-a-password>'
aevra start --ui
```

Aevra validates the credentials before opening listeners, starts the internal Admin and MCP services on loopback, starts the unified HTTPS Public Gateway, and opens the Aevra login page. Keep the terminal running unless Aevra is installed as a background service.

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
