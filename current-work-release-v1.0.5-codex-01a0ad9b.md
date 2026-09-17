# Current Work — Aevra v1.0.5 Release Sync and Commit

Updated: 2026-09-17T13:35:00+07:00 | Status: done
Task: release-v1.0.5-codex-01a0ad9b | Owner: Codex
Repo: F:\my-repos\my-opensources\aevra | Branch: feat/release-v1.0.5 | Initial HEAD: 1e86669e8c1887cb10d7f51754bacadb4cb06af8
Related: current-work.md (historical browser-control tracker) | Archive: none

## Goal

- Preserve all current tracked and untracked changes on `feat/release-v1.0.5`, synchronize v1.0.5 release documentation, resolve the reported CI failures, and commit the complete worktree as multiple coherent commits.

## Human Spec

- REQ-001 | confirmed | Create a new branch for all current changes; preserve the dirty worktree | source: user request
- REQ-002 | confirmed | Update the changes log so all implemented current changes are under v1.0.5 | source: user request
- REQ-003 | confirmed | Synchronize docs specs and the user guideline with implemented behavior | source: user request
- REQ-004 | confirmed | Commit all changes as multiple safe split commits | source: user request
- REQ-005 | confirmed | Do not create a worktree or discard unrelated current edits | source: AGENTS.md and user workflow
- REQ-006 | confirmed | Resolve missing Chromium provisioning, portability timeout, and LOC-lint failures; consolidate this branch into several safe commits above `main` | source: follow-up user request

## Acceptance

- [x] AC-001 | REQ-001 | Current worktree is preserved on `feat/release-v1.0.5` and branch points at the pre-existing HEAD before commits.
- [x] AC-002 | REQ-002 | `CHANGELOG.md` has complete v1.0.5 coverage for browser, desktop, MCP upstream, manifest, security, CLI, and UI changes.
- [x] AC-003 | REQ-003 | README, `GUIDELINE.md`, canonical specs, manual indexes, and roadmap contain no stale current release/tool-count contradictions; historical references remain intentional.
- [x] AC-004 | REQ-004 | All current tracked/untracked changes are committed in multiple reviewable groups; final status is clean after the tracker update commit.
- [x] AC-005 | REQ-004 | Fresh typecheck, tests, build/package checks, and full-gate result are recorded with failures labeled.

## Assumptions / Questions

- ASM-001 | The current dirty worktree is the complete implementation to release, not a request to selectively discard feature groups | affects: all changed paths | blocking: no | state: accepted
- ASM-002 | `feat/release-v1.0.5` is the appropriate branch name because no name was supplied and repository guidance uses `feat/` | affects: branch | blocking: no | state: accepted

## Edit Scope

- `CHANGELOG.md`, `README.md`, `GUIDELINE.md`, `docs/specs/**`, `docs/user-manual/**`, `docs/ROADMAP.md` | release documentation synchronization | planned
- `docs/superpowers/plans/2026-09-17-v1-0-5-release-sync-and-commit.md` | executable plan | owned
- `current-work-release-v1.0.5-codex-01a0ad9b.md` | tracker and evidence | owned
- All existing dirty implementation paths | audit and staged commit ownership only; preserve content | shared/unattributed until staged

## Baseline / External Changes

- `main` | observed 2026-09-17 | HEAD `1e86669e8c1887cb10d7f51754bacadb4cb06af8` | owner: pre-existing human/agent work
- `feat/release-v1.0.5` | created 2026-09-17 from baseline HEAD | dirty worktree retained | owner: Codex release task

## Checkpoints

- [x] CP-001 | REQ-001 | Read required skills and repository instructions.
- [x] CP-002 | REQ-001 | Created `feat/release-v1.0.5` without resetting the worktree.
- [x] CP-003 | REQ-002/003 | Audited current v1.0.5 changelog/spec/manual coverage and found README tool-count and guideline gaps.
- [x] CP-004 | REQ-002/003 | Wrote the release plan and tracker before documentation edits.
- [x] CP-005 | REQ-002/003 | Updated the v1.0.5 changelog, README tool count/features, GUIDELINE workflows, canonical spec index/protocol/workspace sections, docs index, and roadmap wording.

## Remaining

- [x] Update release docs and guideline | REQ-002/003 | depends: CP-004
- [x] Split, stage, check, and commit all current changes | REQ-004 | depends: docs audit
- [x] Run fresh verification and record exact results | REQ-005 | depends: commits
- [x] Correct release verification fixtures, stabilize Windows coverage timing, and format the final six files | REQ-004/005 | depends: initial gate findings
- [x] Resolve CI browser provisioning, stdio portability timing, and registry LOC violations | REQ-006 | depends: follow-up CI evidence

## Changes

- CHG-001 | `docs/superpowers/plans/2026-09-17-v1-0-5-release-sync-and-commit.md` | plan document | before ∅ → after new plan | diff: D001 | REQ-004 | what: release workflow and commit boundaries | why: make the multi-step request auditable | validation: VAL-012 pass
- CHG-002 | `current-work-release-v1.0.5-codex-01a0ad9b.md` | tracker | before ∅ → after new tracker | diff: D002 | REQ-001..005 | what: requirements, scope, evidence structure | why: preserve continuity and attribution | validation: VAL-013 pass
- CHG-003 | `CHANGELOG.md`, `README.md`, `GUIDELINE.md`, `docs/README.md`, `docs/specs/README.md`, `docs/specs/03-mcp-protocol.md`, `docs/specs/06-workspaces-execution.md`, `docs/ROADMAP.md` | release documentation | before: missing upstream/guideline coverage and README count 50 → after: v1.0.5 coverage and 60 built-in tool count | diff: D003 | REQ-002/003 | what: synchronized shipped contracts and user guidance | why: prevent release documentation drift | validation: VAL-003 pass
- CHG-004 | `GUIDELINE.md`, `current-work-release-v1.0.5-codex-01a0ad9b.md` | Markdown formatting and evidence | before: two task-owned files failed Prettier → after: formatted files plus exact release verification results | diff: D004 | REQ-003/004 | what: formatted task-owned docs and recorded handoff evidence | why: keep release docs clean without rewriting unrelated implementation files | validation: VAL-011 pass
- CHG-005 | eight upstream/desktop/skill test fixtures plus `scripts/test-coverage-node.mjs` | verification fixture/runtime alignment | before: coverage typecheck and one async unit assertion failed; Windows coverage batch timed out at 120s → after: typed fixtures await async surfaces and the bounded coverage runner retains its 120s contract | diff: D005 | REQ-004/005 | what: aligned tests with current async and transport contracts | why: make release verification reflect actual runtime behavior | validation: VAL-009/010 pass
- CHG-006 | six implementation/test files under desktop settings and MCP upstream | formatting-only cleanup | before: six files failed `prettier --check` → after: all six formatted | diff: D006 | REQ-004/005 | what: removed the final format gate failures | why: keep the full release gate deterministic and clean | validation: VAL-011 pending
- CHG-007 | `.github/workflows/quality-gate.yml`, `scripts/test/quality-gate.test.mjs`, `packages/mcp-upstream/test/stdio-transport.unit.test.ts` | CI portability hardening | before: Node coverage and Windows portability lacked Chromium; Windows stdio deadline was too short for process startup → after: each browser-running job provisions Chromium and the fixture has a platform-safe 500ms deadline | diff: D007 | REQ-006 | what: made browser dependencies explicit and removed the Windows timing flake | why: keep supported CI gates deterministic | validation: VAL-016/017 pass
- CHG-008 | `apps/core/src/mcp-upstream/upstream-registry-{service,runtime}.ts`, registry tests and fixture | LOC-policy refactor | before: registry source/test files were 493/464 lines → after: every related file is under the 350-line limit with the public service API preserved | diff: D008 | REQ-006 | what: separated orchestration, runtime recovery, forwarding, and shared test fixtures | why: satisfy LOC policy without behavior changes | validation: VAL-018 pass

## Evidence

- D001 | apply_patch output | before: baseline branch/worktree | after: plan created | attribution: verified
- D002 | apply_patch output | before: no task-specific tracker | after: tracker created | attribution: verified
- D003 | apply_patch output | before: documentation audit | after: release docs synchronized | attribution: verified
- D005 | commits `f708edf`, `d0d7a9f` | before: coverage fixture/typecheck failures and six format failures | after: verification fixes and formatting cleanup | attribution: verified
- D006 | `rtk npm run test:coverage:node`, `rtk npm run test:coverage:web`, `rtk npm run test:gate` | before: pending final gate | after: Node/web coverage pass; the original full gate identified two LOC-policy failures | attribution: verified
- D007 | workflow and fixture patch | before: CI browser jobs did not install Chromium and the Windows stdio fixture used a 50ms deadline | after: Linux/Windows browser jobs install Chromium and the fixture uses 500ms | attribution: verified
- D008 | registry runtime/test split | before: 493/464-line files | after: 276/278-line source files and split tests pass LOC lint | attribution: verified

## Validation

- VAL-001 | `git branch --show-current` and `git rev-parse HEAD` | pass | covers: REQ-001 | snapshot: `feat/release-v1.0.5`, baseline `1e86669e8c1887cb10d7f51754bacadb4cb06af8`
- VAL-002 | baseline `rtk git status --short` and changed-file inventory | pass | covers: REQ-001/004 | snapshot: current dirty worktree preserved; full inventory captured in plan review
- VAL-003 | stale-reference search and `rtk git diff --check` on release docs | pass with historical references excluded | covers: REQ-002/003 | snapshot: only 1.0.4 historical changelog/design references remain; no whitespace errors
- VAL-004 | `rtk npm run typecheck` | pass | covers: REQ-004 | snapshot: root and web TypeScript typecheck exit 0
- VAL-005 | `rtk npm run test:scripts` | pass, 73/73 | covers: REQ-004 | snapshot: script and quality-contract suite
- VAL-006 | `rtk npm run test:extension` | pass, 90/90; 99.52% statements, 89.69% branches | covers: REQ-004 | snapshot: MV3 extension suite
- VAL-007 | `rtk npm run build` and `rtk npm run build:extension` | pass | covers: REQ-004 | snapshot: React production build and `apps/extension/build/aevra-extension.zip`
- VAL-008 | `rtk npm run test:ui-parity:only` | pass, 21/21 | covers: REQ-003/004 | snapshot: Playwright UI parity suite
- VAL-009 | `rtk npm run test:coverage:node` | pass | covers: REQ-005/006 | snapshot: all 16 Node coverage batches completed and coverage thresholds passed with the 120s batch contract
- VAL-010 | `rtk npm run test:unit` | pass, 909 pass / 0 fail / 1 skipped | covers: REQ-005 | snapshot: async resources/prompts dispatch and skill-access assertions now await their runtime contracts
- VAL-011 | targeted `rtk prettier --check` and `rtk git diff --cached --check` | pass | covers: REQ-005 | snapshot: six previously failing implementation/test files are formatted; both safe split commits are whitespace-clean
- VAL-014 | `rtk npm run test:coverage:web` | pass, 59 files / 285 tests; 94.92% statements, 85.57% branches, 88.75% functions | covers: REQ-005 | snapshot: web V8 coverage thresholds passed
- VAL-015 | `rtk npm run test:gate` | fail at `lint:loc` after formatting, source lint, and the preceding checks | covers: REQ-005 | snapshot: only `apps/core/src/mcp-upstream/upstream-registry-service.ts` (493 lines, limit 350) and `apps/core/test/mcp-upstream-registry-service.unit.test.ts` (464 lines, limit 350) remain over the repository line-count policy; no refactor was authorized within this release/docs scope
- VAL-016 | `rtk npm run test:portability` | pass | covers: REQ-006 | snapshot: 1,446 tests; 1,438 passed, 1 failed before the stdio deadline adjustment; rerun passed after Chromium-backed CdpDriver and stdio timing fixes, with expected skips only
- VAL-017 | `rtk npm run test:coverage:node` | pass | covers: REQ-006 | snapshot: all 16 Node coverage batches completed; Chromium-backed CdpDriver tests ran and coverage thresholds passed
- VAL-018 | `rtk npm run lint:loc` | pass | covers: REQ-006 | snapshot: registry source and test files are split below the 350-line limit
- VAL-019 | `rtk npm run lint`, `rtk npm run typecheck`, `rtk npm run test:scripts`, `rtk npm run test:unit` | pass | covers: REQ-006 | snapshot: lint and typecheck pass; scripts 73/73; unit 909 pass / 0 fail / 1 skipped
- VAL-020 | `rtk npm run test:gate` | pass | covers: REQ-004/005/006 | snapshot: formatting, lint, typecheck, scripts, extension coverage, Node/web coverage, build/package, and 21 UI-parity tests all passed
- VAL-012 | `rtk git diff --check 1e86669e8c1887cb10d7f51754bacadb4cb06af8..HEAD` | pass | covers: REQ-004 | snapshot: complete committed range is whitespace-clean
- VAL-013 | final `rtk git status --short --untracked-files=all` | pass | covers: REQ-004 | snapshot: branch `feat/release-v1.0.5` clean at final evidence commit

## Blockers

- none

## Risks

- RISK-001 | Current implementation spans shared runtime files across several features | impact: a simplistic path-only split could produce incomplete commits | mitigation: inspect mixed hunks and use a shared wiring commit
- RISK-002 | Full gate previously stopped at two line-count policy violations in existing upstream-registry files | impact: `test:gate` was not fully green | mitigation: split runtime and test fixtures; resolved by CHG-008
- RISK-004 | Code-review subagent capability was unavailable in this session | impact: no independent reviewer report | mitigation: staged file-list checks, full-range diff audit, and fresh verification were performed locally

## Trade-offs

- DEC-001 | Branch name | chose: `feat/release-v1.0.5` | rejected: inventing a release branch prefix outside repo guidance | why: matches the requested version and repository branch convention
- DEC-002 | Worktree handling | chose: local branch in existing checkout | rejected: new linked worktree | why: explicit repository instruction forbids new worktrees

## Questions for User

- none

## Next / Handoff

- Next: none
- Handoff: final six-commit branch is ready for review; no push performed

## Resolved

- RES-001 | CI browser and portability failures resolved; LOC policy is green; final consolidated history and full quality gate verified.
