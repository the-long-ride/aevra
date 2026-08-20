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
## Remaining Work
- [ ] Run PR1 security diff review against main.
- [ ] Run available focused verification and source-policy checks.
- [ ] Resolve review findings.
- [ ] Obtain full repository verification or record infrastructure blocker.
- [ ] Finish PR1 and only then start PR2.
## Blockers
- GitHub Actions jobs fail before dependency installation/checkout completes in this repository environment.
## Known Risks
- Full format/lint/typecheck/test/coverage/build evidence is not currently available from Actions.
## Trade-offs
- Preserve compatibility for LOW/MEDIUM issues unless a security bound makes the old behavior unsafe.
- HIGH/CRITICAL security invariants override compatibility.
