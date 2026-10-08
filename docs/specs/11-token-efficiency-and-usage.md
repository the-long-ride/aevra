# Token Efficiency and Usage

**Audience:** engineers & AI agents · **Scope:** result shaping, tool surface, token statistics · **Verified against:** `1.2.0`

## Result shaping

Aevra compacts tool results once, at the MCP edge (`handleJsonRpc`). It never alters file `content`.

- Batch envelopes drop `index`, zero `failed` / `skipped`, repeated `path` and `sensitivity: NORMAL`, and hoist one `untrusted` notice.
- Command results unwrap the inner `{ok,value}`, drop `signal: null` and empty `stderr`, normalise CRLF, keep the final state of redrawn progress lines, collapse three or more identical lines and cap each stream at `maxOutputChars` (default 16,000; 256-200,000; the first 25% and last 75% are kept; `truncated: true`).
- Approval reads return a summary unless `detail: "full"`.
- Terminal escape sequences are stripped whole at the executor.

## Advertised tool list

`tools/list` omits deprecated compatibility fields, default-false hints and bare output schemas, and shortens repeated workspace descriptions. Guard: the default list serialises to at most 54,000 characters.

## Connector profiles

Setting `mcp.connectorProfiles` maps an actor (`connector:<name>`, `oauth:<client>`, `client:<id>`) to `{ toolGroups?, resultFormat? }`.

- Groups: `files`, `commands`, `git`, `changes`, `skills`, `browser`, `desktop`, `control`, `upstream`. `core` is always on.
- A call to a tool in a disabled group fails with `TOOL_GROUP_DISABLED`.
- `resultFormat`: `both` (default), `text`, `structured`.
- Changes apply the next time the client lists tools.
- Admin API: `GET /api/connector-profiles`, `PUT /api/connector-profiles/:actor` (audited as `connector.profile.update`).

## Token usage

Token counts are estimates (`heuristic-v1`): ASCII `ceil(length / 4)`; other text by code point (CJK, Hangul, kana, full-width and emoji 1.0, other non-ASCII 0.5, ASCII 0.25).

Counted: the serialised request arguments (`inputTokens`), the response body actually sent (`outputTokens`) and the shaper's saving (`savedTokens`).

Stored in `token_usage` (migration 25) per connector, tool and UTC hour. Every 30 seconds and on shutdown the in-memory counters are added to the table. Hourly rows older than seven days fold into host-local day rows; day rows are kept. No arguments, outputs or paths are stored.

`GET /api/usage/tokens?range=24h|7d|30d|90d|all` returns a zero-filled series, totals, today's totals, the top tool today and per-tool and per-connector breakdowns.

The Web UI integrates the 5 token stat cards directly into the 14-cell Runtime Overview table (7×2 grid on desktop), sharing identical styling, borders, and 1-column spans with core runtime statistics, accompanied by an interactive history chart with range selectors.

## Transport

JSON responses of at least 1,024 bytes are gzip-compressed when the client sends `Accept-Encoding: gzip`; event streams are never compressed. Activity-log detail is size-bounded before serialisation.

## Boundaries

This page does not cover provider billing (counts are estimates, not invoices), per-user usage, or the contents of tool calls (never stored).

## Related

- [03-mcp-protocol](03-mcp-protocol.md) — tool surface and errors
- [07-state-migration](07-state-migration.md) — schema evolution
- [Token usage and tool surface](../user-manual/21-token-usage-and-tool-surface.md) — how to use it
