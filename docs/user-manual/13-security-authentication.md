# Security and authentication

## Admin Web UI

Every Core start requires `AEVRA_USERNAME` and `AEVRA_PASSWORD`. Aevra derives in-memory credential verifiers and never persists those raw values in SQLite, logs, audit records, URLs, or browser storage.

The browser signs in through `POST /api/auth/login` over HTTPS. Successful login issues an opaque random Admin session cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`. Multiple independent Admin sessions may coexist. A Core restart revokes all persisted Admin sessions before listeners become available.

The local bootstrap/control secret does not authenticate a browser session and cannot bypass the login page. Admin credentials authenticate only the Admin UI/API; they do not authenticate MCP clients.

Remote Admin exposure is explicit. The browser origin must equal the local Admin origin, the configured `adminPublicUrl` origin, or an exact HTTPS origin in `trustedAdminOrigins`. The MCP/OAuth `publicUrl` does not automatically gain Admin trust. Wildcards, embedded credentials, and plaintext remote Admin origins are rejected, and forwarded host/proto headers never establish trust.

## OAuth

Aevra's canonical MCP endpoint is `/mcp`. OAuth-capable clients discover Aevra's protected-resource and authorization-server metadata automatically from the effective public MCP HTTPS base URL.

Aevra uses Authorization Code with PKCE S256. Redirect URIs are validated exactly. Authorization codes are short-lived and single-use. Access and refresh credentials are stored as hashes rather than raw bearer secrets. Refresh tokens rotate when used, and spent refresh-token hashes are retained until family expiry so replay can be detected. Reusing a spent refresh token revokes the whole refresh family, active access credentials for the connection, and connection YOLO.

OAuth authorization requires **Admin approval** in the Aevra Web UI before a code is released to the remote client.

### Connection continuity

Aevra cannot guarantee one physical HTTP/MCP transport remains open. Continuity is achieved by re-authenticating with a short-lived access token or rotating a refresh token and reattaching to the same logical OAuth connection.

Default lifetimes are:

- access token: 60 minutes;
- refresh family: 30 days, with an absolute family expiry that rotation does not extend;
- reconnect grace: 15 minutes.

The logical OAuth connection is durable and separate from an individual MCP session. A transport detach can therefore create a new MCP session while preserving the same authenticated connection identity. Remembered workspace grants and connection-level YOLO survive eligible reconnects and Core restarts. Session-only workspace leases are rebound only while their original expiry is still valid; reconnect never extends an expired lease.

A normal disconnect or reconnect does **not** automatically replay a mutating request whose response was lost. `operation_get` and `operation_list` expose connection-owned durable operation status so a client can inspect what happened without risking duplicate writes, commits, deletes, or shell commands.

Removing a remembered workspace from an OAuth connection clears that durable connection grant and revokes the workspace from every live session sharing the same OAuth subject, so lease repair cannot silently re-add an explicitly removed workspace.

**Disconnect session** and **Revoke connection** are intentionally different Admin actions. Disconnecting one MCP session does not invalidate OAuth credentials. Revoking a connection invalidates its access and refresh credentials, revokes its live sessions and leases, clears remembered workspace grants, and disables YOLO.

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

Aevra rejects browser credential submission over plain HTTP. Direct HTTPS terminates TLS at Aevra. When a tunnel or reverse proxy terminates the public TLS connection, that provider is part of the transport trust boundary even though the origin connection to Aevra remains HTTPS. Proxy forwarding headers are routing metadata only; they are not an Admin-origin trust source.

## Session isolation

MCP sessions are keyed by actor and subject. OAuth attachment also requires the same durable connection ID. A reconnect restores remembered workspace grants only for that connection subject and never converts a pending or one-shot approval into a broader permission. Remote IP changes are recorded but do not replace actor/subject/connection authentication.

Operation history is connection-scoped. A different OAuth subject, an unauthenticated session, or a revoked connection cannot retrieve another connection's durable operation status.

## Worker IPC

The Execution Worker is reached only over a Unix domain socket or a Windows named pipe on the Aevra host. It is never exposed on TCP and is not reachable through the Public Gateway.

## Secret handling

Admin passwords stay in process environment and in-memory verifiers. Connector tokens, OAuth access tokens, active refresh tokens, and retained spent refresh-token material are stored as hashes rather than raw bearer credentials. Admin connection projections and MCP operation projections never return raw credentials, token hashes, PKCE verifier/challenge values, or refresh-family hash material. DLP redacts known secrets from remote command output before it leaves the Worker.
