# Security and authentication

## OAuth

Aevra's canonical remote MCP endpoint is `/mcp`. OAuth-capable clients discover Aevra's protected-resource and authorization-server metadata automatically.

Aevra uses Authorization Code with PKCE S256. Redirect URIs are validated exactly. Authorization codes are short-lived and single-use. Access and refresh credentials are stored as hashes rather than raw bearer secrets. Refresh tokens rotate when used.

OAuth authorization requires **local approval** in the Aevra dashboard before a code is released to the remote client.

## Bearer connectors

For clients without OAuth but with custom HTTP Authorization support, an Aevra connector token can be sent as:

```http
Authorization: Bearer <token>
```

Treat connector tokens as passwords. Revoke or rotate them if exposed.

Legacy token-in-path URLs remain compatibility-only and are not the recommended setup.

## Cloudflare Access

Cloudflare Access is optional and may be layered in front of plain `/mcp` for deployments that want an additional network identity gate. It is not required for Aevra OAuth.
