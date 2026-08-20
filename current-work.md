# Current Work — Aevra security hardening PR1
Last updated: 2026-08-20T14:25:00+07:00 · Status: in-progress
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
- [x] 2026-08-20T14:25:00+07:00 Codex diff review found canonical-path secret alias bypass.
- [x] 2026-08-20T14:25:00+07:00 Worker now blocks symlink-to-secret and ambiguous hard-link read/search paths.
- [x] 2026-08-20T14:25:00+07:00 Ranged reads preserve prior JS string offsets for multibyte UTF-8.
- [x] 2026-08-20T14:25:00+07:00 runtime.ts restored to the 350-line source-policy limit without logic compression.
- [x] 2026-08-20T14:25:00+07:00 Temporary PR1 verification workflow removed after Actions infrastructure proved unusable.
## Remaining Work
- [x] Run PR1 security diff review against main.
- [x] Run available focused verification and source-policy checks.
- [x] Resolve PR1 review findings.
- [ ] Obtain full repository format/lint/typecheck/test/coverage/build verification or record the infrastructure blocker at handoff.
- [ ] Finish PR1 review/handoff; do not claim fully verified while the full gate is unavailable.
- [ ] Merge PR1 only after acceptable verification, then base PR2 on the merged PR1 state.
- [ ] In PR2/PR4, close command/process/Git routes that can read secret content outside the file-tool security boundary.
## Blockers
- GitHub Actions jobs fail before dependency installation/checkout completes in this repository environment.
## Known Risks
- Full format/lint/typecheck/test/coverage/build evidence is not currently available from Actions.
- Command/process/Git execution remains a separate potential secret-read channel and is explicitly deferred to the authorization/regression hardening PRs.
## Trade-offs
- Preserve compatibility for LOW/MEDIUM issues unless a security bound makes the old behavior unsafe.
- HIGH/CRITICAL security invariants override compatibility.
