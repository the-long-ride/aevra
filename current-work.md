# Current Work — Aevra security hardening PR1
Last updated: 2026-08-20T15:15:00+07:00 · Status: blocked
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
- [x] Structured sanitizer uses null-prototype records so __proto__ remains inert data.
- [x] runtime.ts restored to the 350-line source-policy limit without logic compression.
- [x] Temporary PR1 verification workflow removed after Actions infrastructure proved unusable.
- [x] Local focused Executor file-security suite passed 10/10.
- [x] Local focused MCP file-security suite passed 6/6.
- [x] Local sanitizer prototype-safety regression passed 1/1.
- [x] Local process remote-projection regression passed 2/2.
- [x] Local process-env SQLite persistence regression passed 1/1.
- [x] Local approval persistence sanitizer regression passed.
## Remaining Work
- [ ] Obtain full repository format/lint/typecheck/test/coverage/build verification.
- [ ] Finish PR1 only after acceptable full verification.
- [ ] Merge PR1, then base PR2 on the merged PR1 state.
- [ ] In PR2/PR4, close command/process/Git routes that can read secret content outside the file-tool security boundary.
## Blockers
- GitHub Actions jobs fail before step 1; checkout-only jobs produce no steps and no retrievable log blob.
- This execution sandbox has no GitHub network access and cannot clone the private repository, so full repository gates cannot be run locally here.
## Known Risks
- Full format/lint/typecheck/test/coverage/build evidence is not currently available.
- Command/process/Git execution remains a separate potential secret-read channel and is explicitly deferred to the authorization/regression hardening PRs.
- Hard-link aliases outside registered capability roots cannot be provenance-classified; in-root aliases are covered.
## Trade-offs
- Preserve compatibility for LOW/MEDIUM issues unless a security bound makes the old behavior unsafe.
- HIGH/CRITICAL security invariants override compatibility.
