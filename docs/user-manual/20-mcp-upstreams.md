# MCP servers

Aevra can connect to other MCP servers and republish their tools, resources and prompts to the AI.

## Names and credentials

A server registered as `github` publishes tools as `github__tool`, prompts as `github__prompt`, and resources under `mcp+github://`. Names use lowercase letters, digits and dashes, up to 32 characters.

Store credentials under **Settings → Secret references** first. The MCP server form and `aevra mcp` CLI accept only a secret reference id such as `sr_github`, never a token value. Aevra resolves the reference only when it connects.

## Register a server

Use **Settings → MCP servers → Add server**, or:

```bash
aevra mcp add github --transport http --url https://mcp.example.com/mcp --header Authorization --secret-ref sr_github --risk HIGH
aevra mcp add local-fs --transport stdio --command node --arg server.js --env GITHUB_TOKEN=sr_gh
aevra mcp list
aevra mcp test u1
aevra mcp remove u1
```

Registration connects once and fetches the catalog. If the handshake fails, nothing is stored.

## Risk and advisory hints

The operator-selected risk tier applies to every tool from the server and is the only source used for authorization. The server's `readOnlyHint` and `destructiveHint` annotations are shown as advisory only; they cannot lower the risk tier or bypass approval.

## Status and review

Active servers are published normally. Degraded servers stay visible so a temporary outage does not silently change the tool list. A server that changes its catalog moves to **Needs review**, and its entries stop serving until the operator reviews the added, removed and changed entries and chooses **Acknowledge**.

Upstream calls require a selected workspace and are audited. Sampling is not proxied, and catalog changes are observed when clients re-list or reconnect.

If a connection drops just before a call is sent, that call fails instead of being
silently replayed. A later request reconnects and validates the catalog; changed
catalogs still require acknowledgement before execution resumes.
