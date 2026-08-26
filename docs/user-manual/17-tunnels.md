# Tunnel and public HTTPS modes

Aevra keeps its internal Admin and MCP listeners on loopback. The configured exposure provider publishes the MCP/OAuth path through the local HTTPS Public Gateway, and the **Public MCP URL** is the canonical base used by OAuth metadata and `/mcp`.

Remote Admin access is optional and can use a different hostname or tunnel. Configure that browser-facing URL separately as **Admin public URL** and ensure the external route reaches the Admin UI/API. The MCP public origin is not implicitly trusted for Admin requests.

## Direct exposure

Bind the Public Gateway on a public or LAN address and terminate TLS in Aevra.

1. Issue a trusted certificate for the hostname clients will use.
2. Set `AEVRA_TLS_CERT` and `AEVRA_TLS_KEY` in the Aevra process environment.
3. Choose **Direct HTTPS**, set the Public MCP HTTPS URL, and choose the bind host (`0.0.0.0` to listen on all interfaces).
4. Open the chosen public port to that host.

Aevra refuses Direct HTTPS when only the managed localhost certificate is available.

## Caddy

Point Caddy at the local Public Gateway. Aevra stays in **External / Custom** mode.

```caddy
aevra.example.com {
  reverse_proxy https://127.0.0.1:47830 {
    transport http {
      tls_insecure_skip_verify
    }
  }
}
```

Set Aevra's Public MCP URL to `https://aevra.example.com`. Caddy terminates public TLS; the origin hop remains HTTPS.

If you also publish the Admin UI, prefer a distinct hostname such as `aevra-ui.example.com`, route it deliberately to the Admin UI/API, set that value as **Admin public URL**, and keep the Aevra Admin login enabled. Only the exact configured Admin origin (plus explicit additional trusted origins) is accepted for Admin browser mutations.

## Tailscale Funnel

Publish the local gateway through Tailscale without opening inbound ports.

```bash
tailscale funnel --bg https+insecure://127.0.0.1:47830
```

Use the Funnel HTTPS hostname as Aevra's Public MCP URL in **External / Custom**. Funnel is a transport provider; Aevra OAuth still authorizes MCP clients.

## FRP

Run `frps` on a VPS with a public certificate, and `frpc` on the Aevra host.

```ini
[aevra]
type = https
local_ip = 127.0.0.1
local_port = 47830
custom_domains = aevra.example.com
```

Choose **External / Custom** and set `https://aevra.example.com` as the Public MCP URL. Do not put Admin credentials in the FRP configuration.

## Reverse SSH

Forward a remote listener back to the local gateway:

```bash
ssh -N -R 47830:127.0.0.1:47830 user@edge.example.com
```

Put a TLS reverse proxy on the edge host in front of that forwarded port, then set Aevra's Public MCP URL to the edge HTTPS origin.

## ngrok managed mode

Install the `ngrok` CLI and authenticate it with ngrok's own configuration or environment. Aevra does not persist ngrok authentication tokens.

Two managed domain modes are available:

- **Automatic** - Aevra starts ngrok against the local Public Gateway and adopts the discovered HTTPS URL.
- **Stable domain** - enter the reserved ngrok HTTPS URL as the Public MCP URL. Aevra starts ngrok with that requested URL and verifies the discovered forwarding origin. If ngrok reports another origin, Aevra stops the child and reports a stable-domain mismatch; it does not silently fall back to a random URL.

## ngrok external mode

Start ngrok yourself:

```bash
ngrok http https://127.0.0.1:47830
```

Choose **ngrok** + **External process** (or **External / Custom**) and paste the resulting HTTPS URL as the Public MCP URL. Restarting ngrok changes an automatic hostname; update Aevra when that happens. A reserved domain remains stable when configured by the external ngrok process.

## Separate Admin tunnel

The MCP/OAuth exposure provider and Admin browser exposure do not need to be the same. You may keep Admin local-only, publish it through a private VPN, or use a separate authenticated reverse proxy/tunnel and hostname. Configure that browser-facing HTTPS URL under **Administration Web UI**, then use **Test Admin URL**.

`adminPublicUrl` is the canonical Admin URL and its exact origin is trusted automatically. `trustedAdminOrigins` is only for additional browser origins. Aevra does not accept wildcard origins, plaintext remote Admin origins, embedded credentials, or trust inferred from `Forwarded` / `X-Forwarded-*` headers.
