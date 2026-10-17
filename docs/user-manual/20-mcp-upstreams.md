# MCP servers

Aevra can connect to other MCP servers and republish their tools, resources and prompts to the AI.

## Names and credentials

A server registered as `github` publishes tools as `github__tool`, prompts as `github__prompt`, and resources under `mcp+github://`. Names use lowercase letters, digits and dashes, up to 32 characters.

Store credentials under **Settings → Secret references** first. The MCP server form and `aevra mcp` CLI accept only a secret reference id such as `sr_github`, never a token value. Aevra resolves the reference only when it connects. Use **Edit** on a reference to replace its value.

## Register a server

Use **Settings → MCP servers → Add server**, or:

```bash
aevra mcp add github --transport http --url https://mcp.example.com/mcp --header Authorization --secret-ref sr_github --risk HIGH
aevra mcp add local-fs --transport stdio --command node --arg server.js --env GITHUB_TOKEN=sr_gh
aevra mcp list
aevra mcp test u1
aevra mcp disable u1
aevra mcp enable u1
aevra mcp remove u1
```

Registration connects once and fetches the catalog. If the handshake fails, nothing is stored.

## Enable and disable a server

Disable a server to take it out of service without removing it. In the Web UI, use the switch in the server's row under **Settings → MCP servers**. From the CLI:

```bash
aevra mcp disable u1   # prints: [aevra] Disabled u1
aevra mcp enable u1    # prints: [aevra] Enabled u1
```

While a server is disabled:

- Its tools, prompts and resources are hidden from the lists the AI sees.
- Calls, prompt reads and resource reads for it are refused with `MCP_UPSTREAM_DISABLED`.
- Its connection to the server is closed, so a disabled stdio server does not keep a process running.
- **Test** and refresh also fail with `MCP_UPSTREAM_DISABLED`. Enable the server first.
- Editing the server saves your changes without connecting. The server stays disabled until you enable it. If the edit changed how Aevra connects (transport, address or credentials), the server is marked **Degraded** until it is checked.
- Disabling takes effect at once, even while a call or refresh to that server is still running; that call fails when its connection closes.
- A server cannot be added disabled, because Aevra must connect to it once to record its catalog. Add it, then disable it.

When you enable a **Degraded** server, Aevra connects to it right away. If the catalog is unchanged the server returns to **Active**; if it changed, the server goes to **Needs review**. If the server cannot be reached, it is still enabled but stays **Degraded**, and the response includes a `warning` (the CLI prints `[aevra] Warning: ...`).

If Aevra disables a server but cannot close its connection, the change still applies, the response includes a `warning`, and the audit record is written with the result `warning`.

Disabling keeps the stored configuration, credentials and secret references. Enabling does not reconnect straight away; the first use after that connects and checks the catalog against the stored fingerprint, as after any reconnect. Enabling does not clear **Needs review**: a server whose catalog changed still needs **Acknowledge**. Disabling a server affects only what Aevra republishes. It does not revoke client OAuth connections to Aevra.

Enabling or disabling a server that is already in that state does nothing and writes no audit entry.

Known limit: Aevra does not send a `list_changed` notification when a server is enabled or disabled. A client that is already connected sees the change the next time it lists tools, prompts or resources, and a stale entry it still holds is refused when called.

### Admin API and audit

The Web UI and CLI use these Admin routes. Both need an authenticated Admin session and return the updated server record.

| Route                                  | Effect               |
| -------------------------------------- | -------------------- |
| `POST /api/mcp/upstreams/{id}/enable`  | Enables the server.  |
| `POST /api/mcp/upstreams/{id}/disable` | Disables the server. |

A change is audited as `mcp.upstream.enable` or `mcp.upstream.disable`, with the server name as the target.

## Listing and pagination

In the Web UI (**Settings → MCP servers**), registered servers are presented in a searchable, filterable, and paginated data table. Operators can configure page size (5, 10, 25, 50, or 100 rows per page), search server names/configurations, and filter by status (`Active`, `Degraded`, `Needs review`, `Disabled`), a separate **Enabled** filter (`Enabled`, `Disabled`), transport (`stdio`, `http`, `sse`), and risk tier (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`). Each row shows one status badge: green **Active**, amber **Degraded** or **Needs review**, or neutral **Disabled**. Disabled rows are dimmed and do not also show Active; disabling does not clear a pending catalog review.

In the CLI, `aevra mcp list` formats registered upstream servers in an aligned box-drawing table displaying a `!` marker column (set for enabled servers in **Needs review**), server ID, Name, Transport, State, Enabled (`yes` or `no`), Tool Count, and Risk Tier. Under the table it prints one hint line for each marked server, pointing to `aevra mcp review <id>` (or `aevra mcp test <id>` when no catalog is held):

```text
┌───┬─────────────────────────────────────────┬────────┬───────────┬──────────────┬─────────┬─────────┬────────┐
│ ! │ ID                                      │ Name   │ Transport │ State        │ Enabled │ Tools   │ Risk   │
├───┼─────────────────────────────────────────┼────────┼───────────┼──────────────┼─────────┼─────────┼────────┤
│   │ mu_e0e52809-be98-47f6-88e3-9aa7afaf1948 │ engram │ stdio     │ active       │ yes     │ 9 tools │ MEDIUM │
│ ! │ mu_docs                                 │ docs   │ http      │ needs-review │ yes     │ 4 tools │ LOW    │
└───┴─────────────────────────────────────────┴────────┴───────────┴──────────────┴─────────┴─────────┴────────┘
[aevra] docs changed its catalog (+1 added, -0 removed, ~1 changed). Run: aevra mcp review mu_docs
```

When no upstream servers are registered, `aevra mcp list` displays `No MCP servers registered.`

## Risk and advisory hints

The operator-selected risk tier applies to every tool from the server and is the only source used for authorization. Open the **Detail** info button in a row's action column to inspect all recorded tools, including tools without annotations. Search by tool name or instructions, then expand a tool for its server-provided description, parameter list, example JSON arguments and full input schema. Supplied examples/defaults take precedence; generated examples are labeled **Illustrative** and require checking against the schema. Unsupported references or complex schemas show the schema without inventing arguments. These examples are documentation and are never executed by the modal. Pending catalog documentation is labeled until acknowledged. Close with **Close** or Escape. The server's `readOnlyHint` and `destructiveHint` annotations are shown as advisory only; they cannot lower the risk tier or bypass approval.

## Status and review

Active servers are published normally. Degraded servers stay visible so a temporary outage does not silently change the tool list. A server that changes its catalog moves to **Needs review**, and its entries stop serving until the operator reviews the added, removed and changed entries and accepts the change. In the Web UI, the warning icon opens a review dialog and **Accept changes** acknowledges the catalog.

Upstream calls require a selected workspace and are audited. Sampling is not proxied, and catalog changes are observed when clients re-list or reconnect.

If a connection drops just before a call is sent, that call fails instead of being
silently replayed. A later request reconnects and validates the catalog; changed
catalogs still require acknowledgement before execution resumes.

## Review and accept catalog changes

A pending change is visible as soon as you list servers. The Web UI table marks a server in **Needs review** with a warning icon in the leftmost column; selecting it opens a review dialog with the added, removed and changed entries, and **Accept changes** is in that dialog. In the CLI, `aevra mcp list` marks the same servers with `!` in the first column and prints one next-step hint line for each.

```text
aevra mcp review <id>        # show what changed; changes nothing
aevra mcp accept <id> --yes  # accept exactly the catalog just shown
```

`aevra mcp accept <id>` without `--yes` prints the diff and stops. With `--yes` it prints the diff, then accepts the catalog it just showed, so you never accept a catalog you did not see. If the catalog changed again in the meantime, the command exits with an error telling you to run `aevra mcp review <id>` again. A server that Aevra holds no catalog for (blocked) is not accepted; run `aevra mcp test <id>` first (enable a disabled server before testing it). Review and accept also work for a disabled server, although the list marker covers enabled servers only.

Every accept is audited as `mcp.upstream.acknowledge`; a refused or failed accept writes nothing.

## Acknowledged catalog boundary

Only names and resource URIs in the acknowledged catalog can be forwarded. An unlisted request stops serving pending review. Prompt argument definitions and resource MIME types participate in the review fingerprint alongside tool schemas.

The UI sends the fingerprint of the pending catalog it displayed when acknowledging. If the catalog changed meanwhile, the API returns `409 MCP_UPSTREAM_CATALOG_CHANGED`; refresh and review again. Direct API clients must send `expectedFingerprint` to `POST /api/mcp/upstreams/{id}/acknowledge`.

Upstream descriptions are bounded, stripped of terminal/control characters, and marked untrusted. Stdio servers inherit a minimal environment plus explicitly configured credentials; they do not inherit the daemon's full environment.

Catalog fingerprints use a type-preserving, versioned encoding. Stored hashes from the older encoding trigger review at the next refresh or reconnect, even if the visible catalog appears unchanged. Review and acknowledge that catalog before resuming serving. Schema annotation text is labeled as untrusted; literal values and validation constraints retain their original meaning. Oversized or excessively deep schemas are rejected rather than silently rewritten.

Disabling invalidates configuration handshakes already in progress, including restoration after a failed edit. Re-enabling does not authorize an older pending edit; retry the edit explicitly if still wanted.
