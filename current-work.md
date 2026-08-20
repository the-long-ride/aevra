# Current Work — Aevra security hardening PR2
Last updated: 2026-08-20T15:45:00+07:00 · Status: in-progress

## Goal
Make privileged ID-addressed operations reconnect-safe by actor+subject+workspace ownership, add process host step-up, and prove YOLO revocation keeps the session alive.

## Checkpoints (done)
- [x] Approved four-PR security-hardening architecture.
- [x] PR1 secret/data isolation merged to main.
- [x] PR1 added central SecurityGuard resource boundary.
- [x] PR1 blocked SECRET file read/search/mutation including YOLO and alias variants.
- [x] PR1 masked SENSITIVE reads/search and forced one-time mutation approval.
- [x] PR1 isolated child environments and sanitized approval/process persistence.
- [x] PR1 removed remote host process paths and bounded ranged reads.
- [x] PR1 focused Executor file-security suite passed 10/10.
- [x] PR1 focused MCP file-security suite passed 6/6.
- [x] PR1 sanitizer/projection/persistence focused regressions passed.
- [x] security/02-authorization-isolation fast-forwarded to merged main.

## Remaining Work
- [ ] Persist reconnect-safe owner actor+subject metadata for approval/change/process records.
- [ ] Add SecurityGuard ownership tuple authorization.
- [ ] Guard approval status/cancel/resume by owner tuple.
- [ ] Guard change status/commit/rollback by owner tuple.
- [ ] Guard process status/wait/log/stop/restart by owner tuple.
- [ ] Add host-execution step-up for process_start.
- [ ] Prove disabling YOLO restores baseline policy without changing session/lease IDs.
- [ ] Audit denied ownership attempts without sensitive payloads.
- [ ] Close command/process/Git secret-read paths identified during PR1 review.
- [ ] Run focused exploit tests and available source-policy checks.
- [ ] Merge PR2, then base PR3 on merged main.

## Blockers
- GitHub Actions jobs previously failed before step 1 and produced no job log blob.
- Full private-repo clone is unavailable from the execution sandbox.

## Known Risks
- Full format/lint/typecheck/test/coverage/build evidence may remain unavailable until GitHub Actions runner service recovers.
- Command/process/Git execution can read workspace files independently of file-tool sensitivity checks and must be closed in PR2/PR4.

## Trade-offs
- Preserve compatibility for LOW/MEDIUM issues unless a security bound makes the old behavior unsafe.
- HIGH/CRITICAL security invariants override compatibility.

## Resolved
- PR1 full CI gate unavailable due Actions infrastructure; user explicitly requested merge-to-main and continuation.
