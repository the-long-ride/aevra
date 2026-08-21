# Remote access

Aevra exposes one HTTPS Public Gateway for the Web UI, Admin API, MCP, OAuth, and discovery routes. Internal Admin and MCP listeners stay on loopback; the selected exposure provider decides how the Public Gateway is reached.

## Provider choices

- **Local** — loopback-only access. Use this when the Web UI and MCP client run on the Aevra host.
- **Direct HTTPS** — Aevra binds the Public Gateway directly for remote access. Configure a trusted certificate with `AEVRA_TLS_CERT` and `AEVRA_TLS_KEY`; Aevra does not fall back to a self-signed public certificate.
- **Cloudflare** — Aevra can manage `cloudflared` or use externally managed Cloudflare configuration. Cloudflare Access is an optional additional outer gate.
- **ngrok** — Aevra can launch an installed `ngrok` agent and discover its HTTPS forwarding URL. Authentication tokens stay in ngrok's own configuration or environment and are not persisted by Aevra.
- **External / Custom** — supply the final public HTTPS URL while another process publishes the local gateway. Examples include Caddy, Tailscale Funnel, FRP, a reverse SSH tunnel, another ngrok process, or a comparable reverse proxy/tunnel service.

Open **Settings > Remote Access** or the Remote Access section in Onboarding, choose the provider, save, then use **Test endpoint**. Aevra displays both the local gateway URL and the effective public URL when one exists.

See [Tunnels and public HTTPS](17-tunnels.md) for Direct exposure, Caddy, Tailscale Funnel, FRP, reverse SSH, and ngrok managed/external examples.

External / Custom mode does not automatically widen Aevra's bind address. If a reverse proxy runs on another machine, deliberately configure an appropriate network bind and trusted TLS rather than relying on forwarded headers from arbitrary clients.

## Transport boundary

Direct HTTPS encrypts the browser-to-Aevra connection with Aevra's configured certificate. When Cloudflare, ngrok, Caddy, or another proxy terminates public TLS, that provider is part of the transport trust boundary; the proxy-to-Aevra origin remains HTTPS, but this is not cryptographic browser-to-Aevra end-to-end encryption.

Cloudflare Access is optional and Cloudflare-specific. Aevra OAuth remains the normal authentication layer for OAuth-capable MCP clients, and the Aevra Admin login remains mandatory even when Cloudflare Access is enabled.
