# Quick start

Aevra gives an AI client controlled access to registered local workspaces. The local dashboard is the control plane for setup, approvals, recovery, processes, and security.

## Fast path

1. Install and build Aevra.
2. Run `aevra start --ui`.
3. Complete **Getting Started** in the local dashboard.
4. Configure a public Cloudflare Tunnel hostname under **Remote Access**.
5. In **Connect an AI**, copy `https://<your-hostname>/mcp`.
6. In ChatGPT, create a custom MCP app with that URL and choose OAuth.
7. Approve the pairing request in Aevra when it appears.
8. Register a workspace locally and select it from the AI client.

Aevra keeps workspace registration and sensitive administrative changes local. Remote clients receive only the capabilities granted by local policy.
