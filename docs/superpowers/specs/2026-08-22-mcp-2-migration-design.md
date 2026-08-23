# MCP 2.0 Migration Design

## Goal

Add MCP protocol revision `2026-07-28` to Aevra while preserving compatibility with the existing 2025-era MCP clients.

## Protocol behavior

Aevra will support two protocol eras on the same `/mcp` and `/mcp/:connector` endpoints.

For `2026-07-28`, Aevra will:

- implement `server/discover`;
- require `MCP-Protocol-Version: 2026-07-28` and per-request `_meta.io.modelcontextprotocol/protocolVersion`;
- require `Mcp-Method` for all HTTP requests and `Mcp-Name` for `tools/call`, `resources/read`, and `prompts/get`;
- validate mirrored headers against the JSON-RPC body and return HTTP 400 with JSON-RPC error code `-32020` on mismatch;
- not require, emit, or consume `Mcp-Session-Id` as protocol state;
- stamp `io.modelcontextprotocol/serverInfo` into modern successful results;
- add required `ttlMs` and `cacheScope` fields to cacheable modern results;
- keep tool ordering deterministic.

For legacy revisions `2025-11-25`, `2025-06-18`, and `2025-03-26`, Aevra will preserve the existing `initialize` + `Mcp-Session-Id` flow.

## Aevra application state

MCP 2.0 removes protocol sessions, but Aevra still needs an internal security context for workspace leases, approvals, YOLO state, and audit attribution. Modern requests therefore reuse an internal Aevra security session keyed by the authenticated `actor + subject`. That internal identifier never appears as an MCP protocol session header.

This keeps transport semantics stateless while retaining Aevra authorization state across requests from the same authenticated connector identity.

## Structure

- `apps/core/src/mcp/modern-protocol.ts` owns MCP 2026 request validation, discovery responses, result metadata, and cache metadata.
- `apps/core/src/mcp/server.ts` performs era detection and delegates modern requests while leaving the legacy flow intact.
- `apps/core/src/sessions/session-manager.ts` exposes identity-based internal-session reuse.
- `packages/mcp-tools/src/register.ts` remains the JSON-RPC dispatcher; modern response decoration happens at the ingress boundary.
- integration tests extend the existing ChatGPT/MCP test suite with modern discovery, stateless calls, headers, and backward compatibility.

## Error handling

- Unsupported protocol revisions return HTTP 400 with a structured unsupported-version JSON-RPC error.
- Missing or mismatched required modern headers return HTTP 400 and JSON-RPC error code `-32020`.
- OAuth/authentication failures remain HTTP 401 and are not conflated with protocol negotiation failures.
- Legacy unknown/missing sessions retain their current HTTP 400/404 behavior.

## Verification

The migration is complete when:

1. modern `server/discover`, `tools/list`, and `tools/call` work without `Mcp-Session-Id`;
2. modern header/body mismatches are rejected;
3. modern results contain server identity and required cache metadata where applicable;
4. legacy initialize/session tests continue to pass;
5. lint, typecheck, MCP-focused tests, and the full test suite pass in CI.
