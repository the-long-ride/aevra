# Connect ChatGPT

Complete Remote Access first so Aevra has an effective HTTPS endpoint that ChatGPT can reach.

## In Aevra

Open **Onboarding > Connect an AI > ChatGPT** and copy the displayed MCP endpoint. For a public deployment it has this shape:

```text
https://<effective-public-host>/mcp
```

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

After connection, register or select a workspace before asking the client to access local files or run tools.

If ChatGPT shows **Something went wrong with setting up the connection**, confirm Remote Access is ready, the MCP URL uses the effective public host with `/mcp`, and Aevra's OAuth metadata lists that same HTTPS origin. Then retry the connector setup and approve the pairing request in Aevra.
