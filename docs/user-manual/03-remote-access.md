# Remote access

Aevra keeps its internal Admin and MCP listeners on loopback. Remote MCP/OAuth access is published through the configured HTTPS exposure provider and canonical **Public MCP URL** (`publicUrl`). Remote Admin access is optional and independent: **Admin public URL** (`adminPublicUrl`) identifies the HTTPS URL used by browsers for the Admin UI/API.

The MCP public origin is not automatically trusted for Admin requests. Aevra accepts remote Admin login/mutations only from the local Admin origin, the configured Admin public URL origin, or additional exact HTTPS origins explicitly listed as trusted.

## Provider choices

- **Local** - loopback-only access. Use this when the Web UI and MCP client run on the Aevra host.
- **Direct HTTPS** - Aevra binds the Public Gateway directly for MCP/OAuth remote access. Configure a publicly trusted certificate with `AEVRA_TLS_CERT` and `AEVRA_TLS_KEY`; the managed localhost certificate is rejected for public Direct mode.
- **Cloudflare** - Aevra can manage `cloudflared` or use externally managed Cloudflare configuration. Cloudflare Access is an optional additional outer gate.
- **ngrok** - Aevra can manage an installed ngrok agent with either an automatically discovered URL or a configured stable domain. Authentication tokens remain in ngrok's own configuration/environment and are not persisted by Aevra.
- **External / Custom** - supply the final MCP/OAuth HTTPS URL while another process publishes the local Public Gateway. Examples include Caddy, Tailscale Funnel, FRP, reverse SSH, or another ngrok process.

## Configure MCP and Admin independently

Open **Settings > Remote Access**. The page separates:

- **MCP / OAuth exposure** - provider, ownership/domain mode, and the canonical Public MCP URL used by OAuth metadata and `/mcp`.
- **Administration Web UI** - optional Admin public URL plus additional trusted Admin origins.

Save the exposure configuration, then use **Test endpoint** for MCP/OAuth reachability. If an Admin public URL is configured, use **Test Admin URL** separately. The Admin probe tests the URL currently entered in the form, including any path prefix.

The Admin public URL's exact HTTPS origin is treated as the primary trusted origin. Add aliases only when browsers genuinely use another origin. Trusted Admin origins are exact origins only: no wildcard hosts, embedded credentials, or plaintext HTTP. `Forwarded` and `X-Forwarded-*` headers never expand the trusted set.

See [Tunnels and public HTTPS](17-tunnels.md) for Direct exposure, Caddy, Tailscale Funnel, FRP, reverse SSH, and ngrok automatic/stable/external examples.

External / Custom mode does not automatically widen Aevra's bind address. If a reverse proxy runs on another machine, deliberately configure the network path to the local Aevra listener rather than relying on forwarded headers from arbitrary clients.

## Transport boundary

Direct HTTPS encrypts the client-to-Aevra connection with Aevra's configured certificate. When Cloudflare, ngrok, Caddy, or another proxy terminates public TLS, that provider is part of the transport trust boundary; the proxy-to-Aevra origin remains HTTPS, but this is not cryptographic browser-to-Aevra end-to-end encryption.

Cloudflare Access is optional and Cloudflare-specific. Aevra OAuth remains the normal authentication layer for OAuth-capable MCP clients, and the Aevra Admin login remains mandatory even when an outer access proxy is enabled.
