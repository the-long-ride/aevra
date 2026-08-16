# Troubleshooting

## Aevra refuses to start with ADMIN_CREDENTIALS_REQUIRED

Set both `AEVRA_USERNAME` and `AEVRA_PASSWORD` in the environment of the process that starts Aevra, then retry. Aevra prints that message and exits; it does not dump a stack trace for this configuration error. The username cannot be blank or whitespace-only, and an empty password is rejected.

## The Web UI asks me to sign in again after restart

This is expected. Core startup revokes all persisted Admin sessions before listeners become available. Sign in again with the configured environment credentials.

## Managed Cloudflare login says cert.pem already exists

Run `cloudflared tunnel list`. If it succeeds, the existing login is valid and Aevra should report it as authenticated. Do not delete the certificate merely to repeat the login flow.

## Managed ngrok is unavailable

Install `ngrok` and configure its authentication using ngrok's supported configuration or environment mechanism. Aevra does not persist the ngrok auth token. You can also choose **External / Custom** and run ngrok yourself.

## External / Custom exposure is not reachable

Confirm the supplied public URL is HTTPS and that your proxy or tunnel forwards to Aevra's local HTTPS Public Gateway. External mode intentionally does not widen Aevra's bind address automatically. Caddy, Tailscale Funnel, FRP, reverse SSH, or another tunnel process must be configured to reach the origin deliberately.

## ChatGPT receives 401

Use the effective public `https://<host>/mcp` endpoint with OAuth. A 401 without credentials should advertise OAuth protected-resource discovery information. Approve the pending pairing request in Aevra's authenticated Web UI.

## Browse on server is unavailable

The native picker runs on the Aevra host and requires an available supported desktop picker. Continue using the inline **Server path** browser in the Add Workspace modal; it uses server-side directory listing and does not depend on a graphical picker.

## Certificate generation fails on Windows

Rebuild the current source first. Aevra's Windows local TLS path uses .NET certificate APIs and does not depend on the PowerShell `Cert:` provider or mutable RSA `KeySize` assignment. Direct public HTTPS still requires a separately configured trusted certificate and key.
