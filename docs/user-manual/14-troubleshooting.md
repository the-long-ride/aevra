# Troubleshooting

## Dashboard stays on Loading

Run `node --check apps/web/app.js`, rebuild, and restart Aevra. Browser JavaScript syntax is part of the build gate.

## Cloudflare login says cert.pem already exists

Run `cloudflared tunnel list`. If it succeeds, the existing login is valid and Aevra should report **Authenticated**. Do not delete the certificate just to log in again.

## Public hostname setup fails

Enter a hostname such as `aevra-mcp.example.com`, not a URL with a path or port. Aevra accepts `https://aevra-mcp.example.com` and normalizes it.

## ChatGPT receives 401

Use the canonical `https://<your-hostname>/mcp` endpoint with OAuth. A 401 without credentials should include OAuth protected-resource discovery information. Approve the pending pairing request locally.

## Certificate generation fails on Windows

Rebuild the current source first. Aevra's Windows TLS path uses .NET certificate APIs and does not depend on the PowerShell `Cert:` provider or mutable RSA `KeySize` assignment.
