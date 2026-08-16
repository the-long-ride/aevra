# Security and authentication

## Admin Web UI

Every Core start requires `AEVRA_USERNAME` and `AEVRA_PASSWORD`. Aevra derives in-memory credential verifiers and never persists those raw values in SQLite, logs, audit records, URLs, or browser storage.

The browser signs in through `POST /api/auth/login` over HTTPS. Successful login issues an opaque random Admin session cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`. Multiple independent Admin sessions may coexist. A Core restart revokes all persisted Admin sessions before listeners become available.

The local bootstrap/control secret does not authenticate a browser session and cannot bypass the login page. Admin credentials authenticate only the Admin UI/API; they do not authenticate MCP clients.

## OAuth

Aevra's canonical MCP endpoint is `/mcp`. OAuth-capable clients discover Aevra's protected-resource and authorization-server metadata automatically from the effective public HTTPS base URL.

Aevra uses Authorization Code with PKCE S256. Redirect URIs are validated exactly. Authorization codes are short-lived and single-use. Access and refresh credentials are stored as hashes rather than raw bearer secrets. Refresh tokens rotate when used.

OAuth authorization requires **Admin approval** in the Aevra Web UI before a code is released to the remote client.

## Bearer connectors

For clients without OAuth but with custom HTTP Authorization support, an Aevra connector token can be sent as:

```http
Authorization: Bearer <token>
```

Treat connector tokens as passwords. Revoke or rotate them if exposed.

Legacy token-in-path URLs remain compatibility-only and are not the recommended setup.

## Cloudflare Access

Cloudflare Access is optional and may be layered in front of `/mcp` for deployments that want an additional network identity gate. It is not required for Aevra OAuth and does not replace the Aevra Admin login.

## TLS and proxies

Aevra rejects browser credential submission over plain HTTP. Direct HTTPS terminates TLS at Aevra. When a tunnel or reverse proxy terminates the public TLS connection, that provider is part of the transport trust boundary even though the origin connection to Aevra remains HTTPS.
