# First start

Set the mandatory Admin credentials in the environment, then start Aevra:

```powershell
$env:AEVRA_USERNAME = 'admin'
$env:AEVRA_PASSWORD = '<choose-a-password>'
aevra start --ui
```

Aevra validates the credentials before opening listeners, starts the internal Admin and MCP services on loopback, starts the unified HTTPS Public Gateway, and opens the Aevra login page. Keep the terminal running unless Aevra is installed as a background service.

`aevra ui` can reopen the login page later. It does not create or bypass an authenticated Admin session.

The Web UI supports multiple independent signed-in sessions. All persisted Admin sessions are invalidated whenever the Core starts, so a restart requires signing in again.

On first run, complete **Onboarding** from the dashboard. Configure Remote Access, connect an AI client, register a workspace, and try a bounded operation.

Local exposure keeps the Public Gateway on loopback. Other exposure providers can publish the same authenticated Admin + MCP HTTPS origin without making the internal Admin or MCP listeners directly routable.
