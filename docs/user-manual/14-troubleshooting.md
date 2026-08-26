# Troubleshooting

## Aevra refuses to start with ADMIN_CREDENTIALS_REQUIRED

Set both `AEVRA_USERNAME` and `AEVRA_PASSWORD` in the environment of the process that starts Aevra, then retry. Aevra prints that message and exits; it does not dump a stack trace for this configuration error. The username cannot be blank or whitespace-only, and an empty password is rejected.

## The Web UI asks me to sign in again after restart

This is expected. Core startup revokes all persisted Admin sessions before listeners become available. Sign in again with the configured environment credentials.

## Managed Cloudflare login says cert.pem already exists

Run `cloudflared tunnel list`. If it succeeds, the existing login is valid and Aevra should report it as authenticated. Do not delete the certificate merely to repeat the login flow.

## Managed ngrok is unavailable

Install `ngrok` and configure its authentication using ngrok's supported configuration or environment mechanism. Aevra does not persist the ngrok auth token. You can also choose **External / Custom** and run ngrok yourself.

## Managed ngrok stable domain fails

When **Stable domain** is selected, the configured Public MCP URL must be the reserved ngrok HTTPS URL. Aevra passes that URL to ngrok and verifies the discovered forwarding origin. A mismatch fails closed instead of silently falling back to a random ngrok domain. Confirm the reserved domain belongs to the authenticated ngrok account and matches the value in Aevra.

## External / Custom exposure is not reachable

Confirm the supplied Public MCP URL is HTTPS and that your proxy or tunnel forwards to Aevra's local HTTPS Public Gateway. External mode intentionally does not widen Aevra's bind address automatically. Caddy, Tailscale Funnel, FRP, reverse SSH, or another tunnel process must be configured to reach the origin deliberately.

## Remote Admin URL is rejected or unreachable

Configure the browser-facing HTTPS URL under **Settings > Remote Access > Administration Web UI**, then use **Test Admin URL**. The canonical Admin URL is trusted automatically by exact origin; add any genuine browser aliases explicitly. The MCP public origin and forwarded host/proto headers do not grant Admin trust.

## ChatGPT receives 401

Use the effective public `https://<host>/mcp` endpoint with OAuth. A 401 without credentials should advertise OAuth protected-resource discovery information. Approve the pending pairing request in Aevra's authenticated Web UI.

## Aevra reconnects after Windows lock or sleep

Locking the workstation alone does not invalidate the logical OAuth connection, but system sleep or network suspension can close the physical MCP transport. Aevra reconnects through the durable OAuth connection and restores remembered workspace grants. To reduce sleep-triggered disconnects, choose a **Keep awake** policy in Settings. This prevents system idle sleep only; it does not disable the lock screen or force the display to stay on.

If Keep Awake reports unavailable, the platform sleep inhibitor could not be started. Aevra continues running normally and reports the failure instead of crashing. Fix the local platform/service issue or choose **Off**; reconnect continuity remains the fallback for transport loss.

## Browse on server is unavailable

The native picker runs on the Aevra host and requires an available supported desktop picker. Continue using the inline **Server path** browser in the Add Workspace modal; it uses server-side directory listing and does not depend on a graphical picker.

## Certificate generation fails on Windows

Rebuild the current source first. Aevra's Windows local TLS path uses .NET certificate APIs and does not depend on the PowerShell `Cert:` provider or mutable RSA `KeySize` assignment. Direct public HTTPS still requires a separately configured trusted certificate and key.
