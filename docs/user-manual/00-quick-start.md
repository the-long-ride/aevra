# Quick start

Aevra gives an AI client controlled access to registered local workspaces. The Web UI is the administrative control plane for setup, approvals, recovery, processes, and security.

## Fast path

1. Install and build Aevra.
2. Set `AEVRA_USERNAME` and `AEVRA_PASSWORD` in the environment that starts Aevra.
3. Run `aevra start --ui` and sign in to the Aevra Web UI.
4. Under **Remote Access**, choose Local, Direct HTTPS, Cloudflare, managed ngrok, or External / Custom exposure.
5. For a remote client, copy the effective public `/mcp` endpoint shown by Aevra.
6. In ChatGPT, create a custom MCP app with that URL and choose OAuth.
7. Approve the pairing request in Aevra when it appears.
8. Register a workspace from the Web UI and select it from the AI client.

When startup is ready, the terminal shows an aligned service table containing **Core**, **MCP**, and **Dashboard**. Use the MCP row to confirm the local MCP endpoint and the Dashboard row to confirm the local Admin UI URL. With `--ui`, Aevra prints the browser-opening URL after the table. The final startup line is always `[aevra] Press Ctrl+C to stop Aevra.` so it remains easy to find after the endpoints.

Aevra keeps workspace registration and sensitive administrative changes behind the authenticated Admin UI. Remote MCP clients receive only the capabilities granted by local policy.
