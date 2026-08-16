# Connect ChatGPT

Complete Remote Access first so Aevra has a public hostname.

## In Aevra

Open **Getting Started > Connect an AI > ChatGPT** and copy:

```text
https://<your-hostname>/mcp
```

Authentication is **OAuth**. Do not place a secret in the URL.

## In ChatGPT

1. Open the custom MCP app creation flow.
2. Set the server URL to the Aevra `/mcp` URL.
3. Choose OAuth authentication.
4. Scan tools or continue creating the app.
5. ChatGPT opens Aevra's authorization flow.
6. Return to the local Aevra dashboard when a pairing request appears.
7. Verify the client details and pairing code, then choose **Allow**.
8. Complete the OAuth flow in ChatGPT.

After connection, register or select a workspace before asking the client to access local files or run tools.
