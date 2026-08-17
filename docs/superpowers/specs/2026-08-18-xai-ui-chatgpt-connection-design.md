# Aevra xAI UI and ChatGPT Connection Design

## Goal

Keep Aevra's existing local-admin navigation and control-plane features while making the interface compact, calm, and xAI-inspired; provide consistent action feedback; surface incoming remote requests immediately; and make ChatGPT remote MCP setup easier to diagnose and more compatible.

## UI design

Use the supplied xAI design authority: near-black `#0a0a0a` canvas, `#191919` cards, `#212327` hairlines, white primary text, muted gray secondary text, Inter/system sans with regular weights, tracked monospace labels, 8px card radii, and pill-shaped interactive controls. Avoid shadows and decorative rails. The left navigation remains in its current order and contains the same pages, but becomes a borderless compact navigation column rather than a boxed rail.

Desktop remains a dense two-column admin layout. Mobile collapses navigation horizontally and content to one column. Motion is limited to short opacity/transform transitions and respects `prefers-reduced-motion`.

## Action feedback

Add a small browser runtime loaded before the existing app module. It wraps same-origin `/api/*` mutation requests, cloning responses so application code still reads the original body. Successful mutations emit a success toast; failed mutations emit an error toast using the API error message when available. Existing `alert()` success feedback is converted to a toast. Copy actions receive compact copied feedback. Toasts are fixed, non-blocking, keyboard/screen-reader friendly, and automatically expire.

## Live requests and notifications

Poll local admin endpoints for OAuth pairing requests and operation approvals. Seed the first poll without notifying for already-known requests, then notify only for newly-arrived request IDs. Always show an in-app toast. When browser notification permission has already been granted, also issue an OS/browser notification. A compact header Requests pill shows the live pending count and jumps to Approvals.

Polling must not mutate server state and must not wipe forms in progress.

## Remote access live state

A successful remote-access mutation already updates the OAuth public base URL in Core. Preserve that behavior and make the UI reflect it immediately. The runtime watches successful Cloudflare setup/auth/test actions, refreshes status without requiring a full browser reload, updates the header's remote status, and emits specific success/error feedback.

## ChatGPT MCP compatibility and diagnostics

Keep OAuth Authorization Code + PKCE, dynamic client registration, refresh tokens, and the canonical `https://<hostname>/mcp` endpoint. Improve the MCP/OAuth discovery surface and diagnostics rather than weakening authentication:

- expose both standard authorization-server discovery paths (`/.well-known/oauth-authorization-server` and issuer-path-compatible handling where applicable);
- include MCP protocol headers and explicit no-store/cache behavior on OAuth metadata/token responses;
- make `/health` and OAuth metadata useful to the remote reachability check;
- have Cloudflare reachability verify the protected-resource metadata as well as health, so a plain HTTP 200 is not treated as sufficient proof that ChatGPT can discover OAuth;
- return actionable failure messages to the local UI.

The connection flow remains remote HTTPS -> OAuth discovery -> local approval -> PKCE token -> MCP initialize/tools.

## Testing

Extend web shell tests for xAI tokens, borderless navigation, toast/runtime wiring, pending-request notification polling, and preservation of all current pages. Add focused Core tests for OAuth discovery/reachability compatibility. Run web tests, unit/integration tests, typecheck, lint, format check, and build before completion.
