# Aevra Roadmap & Weak-Points Map

**Date:** 2026-08-17 · **Baseline:** Aevra `0.4.0` on branch `aevra-rename` · **Derived from:** the rename/connectors/skills build, two whole-branch reviews, deferred review findings, and a fresh code audit.

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

## Roadmap (25 items, priority order)

### P0 — correctness, security, and trust (do these first)

- [x] **R1. Make `npm test` fully green.** Platform-gate the macOS LaunchAgent test; make the two process-log tests deterministic (flush-before-assert or retry-with-backoff inside the test). _Accept:_ three consecutive `npm test` runs, zero failures, all OSes. Effort **S**.
- [x] **R2. Audit connector lifecycle.** Emit audit events on connector create/revoke (actor = admin session, target = connector id/name). _Accept:_ security test asserting both events land in the hash-chained audit log. Effort **S**.
- [x] **R3. Cap `instructions_read` file size** at 256 KB (same rule as `skill_read`, clear `FILE_TOO_LARGE`-style error). _Accept:_ unit test with oversized AGENTS.md. Effort **S**.
- [x] **R4. Single version source.** `serverInfo.version` derives from `package.json` (read once at startup) instead of a hardcoded string. _Accept:_ test asserts both always match. Effort **S**.
- [x] **R5. Rate-limit connector admission attempts** (token-bucket per source IP; `429` after threshold; counter visible on the Connectors page). _Accept:_ security test proves throttling and that responses stay uniform below the threshold. Effort **M**.
- [x] **R6. Activate CI.** The workflow already runs the full matrix including test:web, build, npm pack, installer validation, docker and fault-injection jobs. _Remaining (needs a human):_ push the repo to a remote - CI cannot run against a local-only repository.

### P1 — hardening & operator UX

- [x] **R7. `aevra connectors list|create|revoke` CLI** mirroring the admin API (token printed once to the terminal). _Accept:_ docs + smoke test create→connect→revoke from shell only. Effort **M**.
- [x] **R8. Release flow + CHANGELOG.md.** Keep a Changelog format; `prepublishOnly` gate already exists — add a version-consistency test (extends R4) and tag convention. _Accept:_ v0.4.0 entry backfilled; documented flow. Effort **S**.
- [x] **R9. Per-connector policy bindings.** Optional fields on create: default workspace, capability profile cap, and TTL (expiry). Admission stays separate from authority — bindings are _defaults and ceilings_, evaluated by the existing lease pipeline. _Accept:_ a connector bound to Read Only cannot obtain a Developer lease; expired token ⇒ the same uniform 401. Effort **M**.
- [x] **R10. Token rotation.** `POST /api/connectors/:id/rotate` issues a fresh token, old one valid for a grace window (default 5 min). _Accept:_ contract test old→new cutover; audit event (via R2). Effort **M**.
- [x] **R12. Skills `skills_list` search + pagination** (`{query, limit, offset}`), server-side filtering. _Accept:_ contract test with 500 fixture skills returns bounded pages. Effort **S**.
- [x] **R13. Dashboard observability pass.** Connectors page shows failed-attempt counts (from R5); Sessions show connector vs Access origin; Audit gets filter-by-actor. _Accept:_ web-shell test covers the new elements. Effort **M**.
- [x] **R14. `aevra status --json`.** Machine-readable daemon status (ports, safe mode, tunnel, workspace count, version). _Accept:_ documented schema + test. Effort **S**.

### P2 — features

- [ ] **R15. OAuth 2.0 admission mode.** Aevra as authorization server (`/authorize` + `/token`) so Claude.ai/ChatGPT connect natively; coexists with Access + connectors. _Accept:_ live Claude.ai OAuth connection documented end-to-end. Effort **L**.
- [ ] **R16. Publish `aevra` to npm + one-line installer** (`curl -fsSL … | sh` / `irm … | iex`) and CI-test `installers/`. _Accept:_ fresh-machine install works without cloning. Effort **M**.
- [x] **R17. MCP resources/prompts surface for skills** (in addition to tools), advertised in `initialize` capabilities. _Accept:_ contract test enumerates both surfaces; clients that ignore them are unaffected. Effort **M**.
- [x] **R18. Usage metrics.** Per-tool call counts/latencies (in-memory, dashboard + `status --json`), opt-in export. _Accept:_ metrics reflect a scripted tool-call sequence. Effort **M**.
- [x] **R19. `aevra backup verify|restore` command** — integrity-check a backup and restore into a fresh state dir, with a dry-run diff. _Accept:_ recovery drill test from backup to working daemon. Effort **M**.
- [x] **R20. Tunnel health watchdog.** Background reachability probe with dashboard banner + optional desktop notification when the tunnel drops. _Accept:_ simulated drop surfaces within one probe interval. Effort **S**.
- [x] **R21. Chunked `file_read`** (`{offset, length}`) for large files, keeping whole-file default. _Accept:_ contract test reads a 5 MB file in chunks. Effort **S**.
- [x] **R22. Always-confirm mode for CRITICAL risk** (configurable global policy: CRITICAL ops require dashboard confirmation even if a remembered rule exists). _Accept:_ policy test — CRITICAL + persistent allow still routes to approval. Effort **S**.

### P3 — later / polish

- [x] **R23. Shell completion** (bash/zsh/pwsh) generated from the CLI surface, shipped with releases. Effort **S**.
- [x] **R24. Example skills pack** — a small curated `~/.agents/skills/aevra-*` set (workspace tour, release checklist) demonstrating the skills surface to new users. Effort **S**.
- [x] **R25. Web UI dark mode + mobile-friendly layout.** Effort **S**.
- [x] **R26. Docs versioning** — stamp docs with the release they were verified against; regenerate on release (extends R8). Effort **S**.

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
