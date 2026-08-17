# Aevra xAI UI and ChatGPT Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing Aevra admin shell with the supplied xAI language, add reliable toast/live-request UX, and harden ChatGPT remote MCP discovery diagnostics.

**Architecture:** Preserve the existing vanilla `app.js` page/controller code and all navigation content. Add a small preloaded UI runtime responsible for cross-cutting feedback and request polling, keep visual changes in `app.css`, and make focused Core changes only where remote OAuth discovery/reachability needs stronger compatibility or diagnostics.

**Tech Stack:** Node.js 22+, TypeScript, vanilla browser JavaScript/CSS, Node test runner, MCP Streamable HTTP, OAuth 2.0 Authorization Code + PKCE, Cloudflare Tunnel.

## Global Constraints

- Preserve all current navigation pages and control-plane content.
- Dark-only xAI-inspired UI from the supplied design authority.
- Remove boxed/rail navigation styling; no decorative shadows.
- Every API mutation gets non-blocking success/error toast feedback.
- Incoming OAuth and operation approval requests are visible without manual refresh.
- Remote-access changes must be reflected immediately without restarting Aevra.
- Do not weaken OAuth, local approval, workspace containment, or safe-mode controls.

---

### Task 1: Lock UI/runtime behavior with web tests

**Files:**
- Modify: `scripts/test/web-admin-shell.test.mjs`
- Test: `scripts/test/web-admin-shell.test.mjs`

**Interfaces:**
- Produces assertions for `apps/web/ui-runtime.js`, xAI CSS tokens, borderless navigation, toasts, request polling, and existing page preservation.

- [ ] Add a failing test asserting xAI tokens (`#0a0a0a`, `#191919`, `#212327`), pill controls, no old neon accent, and a navigation rule with no rail border/background.
- [ ] Add a failing test asserting `index.html` loads `ui-runtime.js` before `app.js`.
- [ ] Add a failing test asserting the runtime wraps API mutations, emits success/error toasts, polls `/api/oauth/requests` and `/api/approvals`, and links the pending badge to Approvals.
- [ ] Run `npm run test:web`; expect the new assertions to fail before implementation.

### Task 2: Add cross-cutting toast and request-notification runtime

**Files:**
- Create: `apps/web/ui-runtime.js`
- Modify: `apps/web/index.html`
- Test: `scripts/test/web-admin-shell.test.mjs`

**Interfaces:**
- Produces `window.aevraUi.toast(message, kind)` and `window.aevraUi.refreshPending()`.
- Wraps `window.fetch` without consuming response bodies by using `response.clone()`.

- [ ] Implement an accessible toast stack and action-name mapping for same-origin `/api/*` mutations.
- [ ] Convert `window.alert` into a success toast while leaving `confirm` unchanged.
- [ ] Poll pending OAuth + operation approvals, seed existing IDs, notify only newly-seen IDs, and keep a Requests count pill synchronized.
- [ ] Use browser `Notification` only when permission is already granted; in-app toast remains the guaranteed notification path.
- [ ] Listen for successful Cloudflare mutations and refresh live Cloudflare/pending status.
- [ ] Load the runtime before the app module in `index.html`.
- [ ] Run `npm run test:web`; runtime tests should pass.

### Task 3: Replace Neon Console chrome with compact xAI design

**Files:**
- Modify: `apps/web/app.css`
- Modify: `scripts/test/web-admin-shell.test.mjs`

**Interfaces:**
- Consumes existing DOM classes/structure from `app.js`; no page-content rewrite.

- [ ] Replace color/type tokens with xAI-derived near-black/white/hairline system.
- [ ] Make nav borderless/transparent, preserve sticky behavior, and use compact pill active states without inset rail indicators.
- [ ] Convert buttons to regular-weight outline pills; reserve white fill for `.primary`.
- [ ] Keep cards as flat 8px charcoal/hairline surfaces with no shadows.
- [ ] Tighten spacing, inputs, grids, guide panel, remote-access card, pairing request, and responsive layout.
- [ ] Respect reduced motion and 44px touch targets on mobile.
- [ ] Run `npm run test:web` and `npm run build`.

### Task 4: Strengthen OAuth discovery and remote reachability diagnostics

**Files:**
- Modify: `apps/core/src/mcp/server.ts`
- Modify: `apps/core/src/cloudflare/manager.ts`
- Modify/Test: existing MCP/OAuth and Cloudflare manager tests under `apps/core/test/`

**Interfaces:**
- `McpIngressServer` continues serving `/.well-known/oauth-protected-resource/mcp` and authorization-server metadata.
- `CloudflareManagerImpl.checkReachability()` returns `{reachable,status?,message}` but verifies both health and OAuth discovery.

- [ ] Add failing Core tests showing reachability is false when health is 200 but protected-resource metadata is unavailable/invalid.
- [ ] Add failing MCP test for discovery metadata headers/path compatibility.
- [ ] Add `cache-control: no-store` to OAuth discovery responses and support the standard issuer-compatible authorization-server metadata route without changing the canonical issuer.
- [ ] Update reachability to fetch `/health`, then `/.well-known/oauth-protected-resource/mcp`, validate `resource` equals `https://<hostname>/mcp`, and report which phase failed.
- [ ] Run the focused Core tests, then the full test suite.

### Task 5: Final verification

**Files:**
- Review all changed files only.

- [ ] Run `npm run format:check`.
- [ ] Run `npm run lint`.
- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Inspect the final branch diff for accidental navigation/content removal, stale Neon Console tokens, secrets, or unrelated refactors.
- [ ] Report the branch name and the root-cause/diagnostic improvements.
