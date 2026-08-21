# Tunnel and public HTTPS modes

Aevra keeps Admin and MCP listeners on loopback and publishes one HTTPS Public Gateway. ChatGPT, Claude, and Gemini must reach that gateway over public HTTPS. Choose a provider in **Settings > Remote Access**, then copy the displayed `/mcp` URL.

OAuth issuer and resource metadata always follow the effective public URL. If the public URL is wrong, ChatGPT fails with "Something went wrong with setting up the connection."

## Direct exposure

Bind the Public Gateway on a public or LAN address and terminate TLS in Aevra.

1. Issue a trusted certificate for the hostname clients will use.
2. Set `AEVRA_TLS_CERT` and `AEVRA_TLS_KEY` in the Aevra process environment.
3. Choose **Direct HTTPS**, set the public HTTPS URL, and choose the bind host (`0.0.0.0` to listen on all interfaces).
4. Open TCP 443 or the chosen public port to that host.

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

Set Aevra's public HTTPS URL to `https://aevra.example.com`. Caddy terminates public TLS; the origin hop remains HTTPS.

## Tailscale Funnel

Publish the local gateway through Tailscale without opening inbound ports.

```bash
tailscale funnel --bg https+insecure://127.0.0.1:47830
```

Use the Funnel HTTPS hostname as Aevra's public URL in **External / Custom**. Funnel is a transport provider; Aevra OAuth still authorizes MCP clients.

## FRP

Run `frps` on a VPS with a public certificate, and `frpc` on the Aevra host.

```ini
[aevra]
type = https
local_ip = 127.0.0.1
local_port = 47830
custom_domains = aevra.example.com
```

Choose **External / Custom** and set `https://aevra.example.com`. Do not put Admin credentials in the FRP configuration.

## Reverse SSH

Forward a remote HTTPS listener back to the local gateway:

```bash
ssh -N -R 47830:127.0.0.1:47830 user@edge.example.com
```

Put a TLS reverse proxy on the edge host in front of that forwarded port, then set Aevra's public URL to the edge HTTPS origin.

## ngrok managed mode

Install the `ngrok` CLI and authenticate it with ngrok's own configuration or environment. In Aevra choose **ngrok** + **Managed by Aevra**. Aevra launches the agent against the local gateway and reads the discovered HTTPS URL. Aevra does not store ngrok tokens.

## ngrok external mode

Start ngrok yourself:

```bash
ngrok http https://127.0.0.1:47830
```

Choose **ngrok** + **External process** (or **External / Custom**) and paste the `https://*.ngrok.app` URL. Restarting ngrok changes the hostname unless you reserved a domain; update Aevra's public URL so OAuth metadata stays aligned.
