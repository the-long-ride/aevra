# Aevra Roadmap & Weak-Points Map

**Date:** 2026-08-25 · **Baseline:** Aevra `0.1.0` · **Derived from:** the rename/connectors/skills build, two whole-branch reviews, deferred review findings, and a fresh code audit.

This is the working map: honest cons first, then the prioritized TODO list (P0 → P3, ordered). Items are checkboxes so progress is trackable. Effort: **S** ≤ half a day · **M** ≤ 3 days · **L** larger.

---

## Weak points & cons (what we found, honestly)

**Trust & security surface**

1. **Connector lifecycle is not audited.** `POST/DELETE /api/connectors` emit no audit events — inconsistent with the audit-everything posture (`apps/core/src/admin/routes/api.ts`).
2. **No rate limiting or failed-attempt visibility** on `/mcp/<token>`. 128-bit tokens make guessing negligible, but attempts are unbounded and invisible.
3. **Connectors are admission-only** — no per-connector workspace binding, profile, or expiry. A leaked connector URL inherits whatever actor mapping exists, forever, until manually revoked. No rotation.
4. **`instructions_read` has no size cap** — an arbitrarily large AGENTS.md is read whole into memory (the same class of issue we already fixed for the skills scan).
5. **Connector `expiresAt` is a fiction** (formal 24 h value, never enforced) — misleading to future readers; there is no real token TTL.

**Test & release health** 6. **`npm test` is never fully green locally:** 1 permanently failing test (`macOS service writes user LaunchAgent` — a Windows path artifact that should be platform-gated) + 2 flaky process-log tests under parallel load. Red marks on every run erode trust. 7. **CI never runs** (no git remote) and its matrix omits `test:web` and `npm run build`. 8. **No CHANGELOG, no release flow.** Version `0.4.0` is duplicated in `package.json` and hardcoded in `apps/core/src/mcp/server.ts` — drift waiting to happen. 9. **The npm package has never been published**; install is clone + build. The `installers/` scripts have no tests.

**Product gaps** 10. **No OAuth 2.0 admission** — connector URL or Cloudflare Access are the only paths; Claude.ai and ChatGPT both natively support OAuth connectors. 11. **Skills surface is list-only** — no search/pagination; a 500-skill library would flood the client's context. 12. **No observability** — audit events exist, but no usage metrics, latency view, or `aevra status --json` for scripting. 13. **Connector management is Web-UI-only** — no `aevra connectors` CLI, so scripted/headless setup is awkward.

---

## Not yet specified (fog — revisit as the frontier advances)

- Multi-actor/multi-user story (today Aevra is deliberately single-user).
- MCP `tools/list_changed` notifications — only needed if the tool set becomes dynamic (e.g., per-workspace tools).
- WebSocket/SSE transport variants if a client requires them.
- Remote workspace mounts (SSH/network roots) — security model unclear until R9 lands.

## Out of scope (ruled out for now)

- Browser extension or DOM automation (removed by design).
- Bypassing AI-client product limits (connector counts, tool limits — platform constraints).
- Running as SYSTEM/root or auto-elevation of any kind.
