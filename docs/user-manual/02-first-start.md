# First start

Run the default vanilla admin UI:

```powershell
aevra start --ui
```

Aevra starts the Core and local MCP listeners over HTTPS and opens the authenticated local dashboard. Keep this terminal running unless Aevra is installed as a background service.

To open the alternate React + TypeScript admin UI instead, start Aevra with:

```powershell
aevra start --ui-react
```

The React UI is served at `/react/`. It uses the same localhost admin authentication, Core APIs, persisted workspaces, permissions, sessions, settings, requests, and onboarding state as the default UI. `--ui` remains the default supported dashboard path; do not pass `--ui` and `--ui-react` together.

On first run, the dashboard opens **Getting Started**. Complete the sections in order: Local Gateway, Remote Access, Connect an AI, Workspace, Try Aevra, and Explore.

Local HTTPS certificates are managed by Aevra. The listeners remain bound to loopback for local administration and execution traffic.
