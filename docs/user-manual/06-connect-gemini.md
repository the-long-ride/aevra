# Connect Gemini

Use:

```text
https://<your-hostname>/mcp
```

Prefer OAuth if the client supports remote MCP OAuth discovery. Approve the first pairing request locally in Aevra.

If the client only supports fixed Bearer credentials, create a connector in Aevra and configure the token as an Authorization Bearer header.

When approving **workspace access** for Gemini, select **Allow this connection**. Clients that open a new MCP session per call across distributed workers can only resume a workspace-access approval that covers the whole connection. Capability approvals, such as deleting a file, need no wider scope: **Allow** (one time) already works from any session on the same connection.
