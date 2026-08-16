# Remote access

A remote AI client cannot reach `localhost`, so Aevra uses a Cloudflare Tunnel to publish only the MCP listener.

## Recommended setup

Open **Getting Started > Remote Access**.

1. Confirm `cloudflared` is detected.
2. If Aevra reports an existing valid Cloudflare login, keep it. Do not run login again.
3. Otherwise choose **Authenticate with Cloudflare**.
4. Enter a public hostname such as `aevra-mcp.example.com`. A hostname-only HTTPS URL is also accepted and normalized.
5. Select an existing tunnel ID or let Aevra create one.
6. Keep tunnel ownership **Managed** unless another service owns the tunnel process.
7. Save, then run **Test endpoint**.

Cloudflare Access is optional. Aevra OAuth is the normal authentication layer for ChatGPT and other OAuth-capable MCP clients.
