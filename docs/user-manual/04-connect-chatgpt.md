# Connect ChatGPT

Complete Remote Access first so Aevra has an effective HTTPS endpoint that ChatGPT can reach.

## In Aevra

Open the dashboard **Onboarding > Connect an AI** block and copy the displayed **MCP endpoint**. The same value is one endpoint for every client; there is no per-provider screen. For a public deployment it has this shape:

```text
https://<effective-public-host>/mcp
```

If the block reads `Configure Remote Access first`, finish Remote Access before continuing. `aevra status` prints the same endpoint as `Public` — append `/mcp` to it.

Authentication is **OAuth**. Do not place an Admin password or connector secret in the URL.

## In ChatGPT

1. Open the custom MCP app creation flow.
2. Set the server URL to the Aevra `/mcp` URL.
3. Choose OAuth authentication.
4. Scan tools or continue creating the app.
5. ChatGPT opens Aevra's authorization flow.
6. Return to the Aevra Web UI when a pairing request appears.
7. Verify the client details and pairing code, then choose **Allow**.
8. Complete the OAuth flow in ChatGPT.
9. In ChatGPT settings / plugin configuration, grant **Permission for Plugins -> Allow all actions** so actions execute without recurring client confirmation dialogs.

After connection, register or select a workspace before asking the client to access local files or run tools.

## Dynamic Cloud VMs & Egress IP Continuity

ChatGPT dispatches tool calls and session turns across rotating cloud runner VMs with dynamic egress IPs. Aevra handles this transparently:

- **Zero re-admission on IP change:** As long as ChatGPT presents its valid OAuth access token, incoming requests from new runner IPs are automatically admitted without requiring operator intervention or re-pairing.
- **Durable workspace grants:** Workspaces granted to the ChatGPT connection remain active across runner VM transitions and transport reconnects. Multiple workspaces can be assigned concurrently in the Admin UI.
- **Approval handoff:** When an operation requires manual confirmation, approved tickets are claimed atomically by the runner resuming the work (`approval_wait`). Unauthorized callers cannot hijack or poison pending approvals.
- **Origin visibility:** The Aevra Admin UI displays the connection's recent runner IP history (up to 10 unique IP addresses within 24 hours) in the connection details modal.

If ChatGPT shows **Something went wrong with setting up the connection**, confirm Remote Access is ready, the MCP URL uses the effective public host with `/mcp`, and Aevra's OAuth metadata lists that same HTTPS origin. Then retry the connector setup and approve the pairing request in Aevra.
