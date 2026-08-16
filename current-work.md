# Current Work — Aevra security hardening PR1

Last updated: 2026-08-21T14:49:00+07:00 | Status: blocked

## Goal

Harden secret/data isolation without changing unrelated MCP behavior.

## Checkpoints (done)

- [x] Approved four-PR security-hardening architecture.
- [x] Added central SecurityGuard resource boundary.
- [x] Added SECRET denial and SENSITIVE masking/one-time mutation approval.
- [x] Added Worker-side secret-file defense-in-depth.
- [x] Added bounded ranged reads with existing JS string offset semantics.
- [x] Isolated host, managed-process, Docker, and Podman child environments.
- [x] Sanitized approval and managed-process persistence.
- [x] Removed host process paths from remote process results.
- [x] Codex diff review found canonical-path secret alias bypass.
- [x] Worker now blocks symlink-to-SECRET paths.
- [x] Worker now detects in-workspace SECRET hard-link aliases for read/search/write/delete/move without blanket-blocking normal hard links.
- [x] Normal hard-linked files remain readable/searchable for compatibility.
- [x] Ranged reads preserve prior JS string offsets for multibyte UTF-8.
- [x] Worker sensitivity elevation is propagated through Core and cannot be downgraded by response paths.
- [x] Masked SENSITIVE reads are excluded from the read-version merge cache.
- [x] Structured approval persistence redacts content, patches, env values, and secret-looking fields.
- [x] Structured sanitizer uses null-prototype records so **proto** remains inert data.
- [x] runtime.ts restored to the 350-line source-policy limit without logic compression.
- [x] Temporary PR1 verification workflow removed after Actions infrastructure proved unusable.
- [x] Local focused Executor file-security suite passed 10/10.
- [x] Local focused MCP file-security suite passed 6/6.
- [x] Local sanitizer prototype-safety regression passed 1/1.
- [x] Local process remote-projection regression passed 2/2.
- [x] Local process-env SQLite persistence regression passed 1/1.
- [x] Local approval persistence sanitizer regression passed.
- [x] Live MCP activity UX: failing tests covered newest-first pagination, search, filters, and page-size controls before implementation.
- [x] Live MCP activity now reuses DataTable with newest-first stream order, Client/Workspace/Type/Status filters, search, page size, and pagination.
- [x] Live MCP activity verification passed: focused 3/3, React 54/54, typecheck, lint, full npm test, and production build all exit 0.
- [x] Activity-detail RED tests covered sanitized/bounded Core payload capture, Details modal input/output, and Recent activity removal.
- [x] MCP activity now records bounded sanitized input/output snapshots and streams them to the local admin UI.
- [x] Live MCP activity now has an Actions/Details button showing sanitized input/output in a local dialog.
- [x] Recent activity standalone Dashboard section removed; its Requests/Sessions/Processes/Changes values remain represented in Runtime overview.
- [x] MCP integration coverage now verifies a real tools/call records input arguments and sanitized result details.
- [x] Activity-detail/Runtime merge verification passed: typecheck, lint, full npm test, build, and git diff --check exit 0; React suite has 56/56 passing.

- [x] Dashboard onboarding ordering/state enforced: incomplete onboarding is first/open; completed onboarding is last/collapsed, including completion-state refresh transitions.

- [x] Compact Dropdown component added with image-style dark listbox options; all React selects now use the shared component and form submissions retain values.
- [x] Compact control pass reduces shared inputs/buttons/dropdowns from 40px to 32px with tighter typography/padding.
- [x] Compact-dropdown verification passed: React 58/58, web typecheck, source lint, production build, and touched-file Prettier checks.

- [x] Connector dashboard root cause identified: Runtime snapshot counted/listed only static Bearer connectors while OAuth clients lived separately under oauth.listClients(), so ChatGPT OAuth sessions never appeared in Connections or the Connectors statistic.
- [x] Dashboard connector inventory now merges registered OAuth clients with static Bearer connectors and derives OAuth last-used time from matching sessions.
- [x] Runtime overview Connectors statistic now counts the unified OAuth + Bearer inventory.
- [x] Connections table now shows Auth type and only exposes Revoke for static Bearer connectors.
- [x] Connector visibility regression verified: unit 215 passed/1 skipped, contract 26 passed, integration 92 passed/3 skipped, security 38 passed/2 skipped, React 59/59 passed, typecheck/lint/build passed, touched files Prettier-clean.
- [x] MCP serverInfo description now advertises chat-driven workspace control with permissions and local approvals; focused initialize regression, typecheck, source lint, and Prettier pass.

- [x] Dashboard runtime-modal redesign approved: local-device datetime rendering, named processes/workspace labels, and Process/Change/Tool/Connector runtime modals.
- [x] Managed process names implemented through MCP schema, SQLite migration/persistence, remote/local projections, restart preservation, and workspace-name admin projection.
- [x] Managed process name verification passed: unit 215 passed/1 skipped and security 39 passed/2 skipped.
- [x] Shared DataTable datetime presentation now supports browser-local date/time formatting with focused regression coverage.

- [x] Runtime overview Managed processes/Open changes/Tool calls/Connectors are interactive and open shared management dialogs.
- [x] Processes/Changes management content moved into reusable Dashboard panels; standalone Processes and Changes navigation pages removed.
- [x] Standalone Dashboard Tool activity and Connections sections removed; their tables/actions now live in runtime modals.
- [x] WebUI datetime columns now use the shared browser-local formatter across audit, sessions, MCP activity, active connections, connectors, processes, and changes.
- [x] Focused runtime-modal/navigation regressions passed: Dashboard 8/8, management panels 6/6, focused React set 23/23, and unit/source contracts passed.

## Remaining Work

- [ ] Restart the currently running Aevra daemon after this session to load the rebuilt dashboard backend; restarting now would invalidate this MCP session.
- [ ] Obtain full repository format/lint/typecheck/test/coverage/build verification.
- [ ] Finish PR1 only after acceptable full verification.
- [ ] Merge PR1, then base PR2 on the merged PR1 state.
- [ ] In PR2/PR4, close command/process/Git routes that can read secret content outside the file-tool security boundary.

## Blockers

- GitHub Actions jobs fail before step 1; checkout-only jobs produce no steps and no retrievable log blob.
- This execution sandbox has no GitHub network access and cannot clone the private repository, so full repository gates cannot be run locally here.
- Full format check is blocked by pre-existing formatting in apps/core/test/connector-bindings.contract.test.ts; task-touched files are Prettier-clean.

## Known Risks

- Full format/lint/typecheck/test/coverage/build evidence is not currently available.
- Command/process/Git execution remains a separate potential secret-read channel and is explicitly deferred to the authorization/regression hardening PRs.
- Hard-link aliases outside registered capability roots cannot be provenance-classified; in-root aliases are covered.

## Trade-offs

- Preserve compatibility for LOW/MEDIUM issues unless a security bound makes the old behavior unsafe.
- HIGH/CRITICAL security invariants override compatibility.
- Live MCP activity controls | chose: reuse shared DataTable | rejected: duplicate table state/pagination logic | why: keeps dashboard controls consistent and minimizes new code.
- MCP activity details | chose: bounded structured-sanitized snapshots | rejected: raw request/response capture | why: local debugging value without weakening secret/content redaction guarantees.

## 2026-08-21 Checkpoint — multi-workspace and admin UX

- [x] Multi-workspace MCP leases and remembered OAuth workspace grants are implemented with explicit workspace targeting and no connection-wide active workspace assumption.
- [x] Session-only workspace access expires on reconnect; remembered connection access restores all granted workspaces without selecting a default.
- [x] Shared DataTable page sizes are 5/10/25/50/100 and shared Dropdown selected rows use a wider pixel-style SVG `<` marker.
- [x] OAuth authorization page, YOLO treatment, Permissions modal, Workspace Copy ID, runtime management modals, and Guide navigation/command references are included in the current tree.
- [x] Obvious `.verify-*` artifacts were removed before commit.
- [x] Final verification passed: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check`.
- [x] All touched files are Prettier-clean; repository-wide `npm run format:check` still reports only the pre-existing `apps/core/test/connector-bindings.contract.test.ts` formatting issue.

## 2026-08-21 Checkpoint ? Guide navigation and branding

- [x] Guide desktop uses a fixed chapter sidebar with sticky search and an independently scrolling chapter list; mobile uses a sticky chapter dropdown.
- [x] Guide manual content owns its vertical scrollbar and keeps Previous/Next at the end of the scrollable article flow.
- [x] OAuth approval panel widened to 960px with a thin command scrollbar fallback for narrow screens.
- [x] Web shell uses the canonical assets/aevra-logo.png plus the favicon set through Vite publicDir.
- [x] `aevra start` prints a plain terminal-safe pixel `.a` banner before readiness lines.
- [x] Focused Guide, OAuth, CLI banner, web asset, and design contracts pass.

## 2026-08-22 Checkpoint — provider-neutral exposure and Admin login

- [x] Aevra now uses a unified HTTPS Public Gateway in front of loopback-internal Admin and MCP listeners, with Local, Direct HTTPS, Cloudflare, managed ngrok, and External / Custom exposure providers.
- [x] `AEVRA_USERNAME` and `AEVRA_PASSWORD` are mandatory at Core startup; password login issues independent secure Admin sessions, bootstrap cannot mint browser sessions, and startup revokes persisted Admin sessions.
- [x] OAuth issuer/resource URLs follow the effective provider-neutral public URL while Cloudflare Access remains an optional Cloudflare-specific outer verifier.
- [x] Remote Access settings and Dashboard status are provider-neutral, including custom tunnel guidance for Caddy, Tailscale Funnel, FRP, reverse SSH, and another ngrok process.
- [x] Add Workspace uses one responsive modal with name and server path together, debounced server-side directory browsing, parent/child navigation, and a host-native `Browse on server` picker with inline fallback.
- [x] Workspace registration canonicalizes the selected server path again; directory browsing and native picker routes remain authenticated Admin-only operations and are not exposed through MCP.
