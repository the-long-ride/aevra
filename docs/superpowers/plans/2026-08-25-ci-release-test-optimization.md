# CI and Release Test Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate release/gate execution and reduce CI wall-clock time while preserving 85% coverage and Linux/Windows validation.

**Architecture:** Make coverage the canonical Linux product-test execution, run repository script tests once, build once before Playwright, and split independent CI work into parallel jobs. Releases verify a successful exact-SHA quality workflow before publishing instead of rerunning the gate; npm lifecycle build work moves from `prepare` to `prepack`.

**Tech Stack:** GitHub Actions, npm lifecycle scripts, Node.js 24, TypeScript, Vitest/V8 coverage, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-ci-release-test-optimization-design.md`

## Global Constraints

- Keep Node.js 24 in CI.
- Keep Linux and Windows validation.
- Keep coverage thresholds at 85% for lines, statements, functions, and branches.
- Keep npm trusted publishing with provenance.
- Release must fail closed if the exact release SHA lacks a successful `quality-gate.yml` push run.

---

### Task 1: Update quality-gate contract tests first

**Files:**
- Modify: `scripts/test/quality-gate.test.mjs`

**Interfaces:**
- Consumes: root `package.json`, `.github/workflows/quality-gate.yml`, `.github/workflows/release.yml`.
- Produces: regression assertions for deduplicated scripts, parallel jobs, exact-SHA release verification, and 85% coverage preservation.

- [ ] **Step 1: Write failing assertions**

Require `test:gate` to use script tests + coverage + one build + Playwright-only execution; reject `prepublishOnly`; require `prepack`; require parallel Linux jobs and a Windows portability job; require release to query `quality-gate.yml` runs for the exact SHA and avoid `npm run test:gate`.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `node --test scripts/test/quality-gate.test.mjs`

Expected: FAIL against the old scripts/workflows because `prepublishOnly`, monolithic matrix gate, release gate rerun, and duplicate UI build behavior still exist.

### Task 2: Deduplicate npm scripts

**Files:**
- Modify: `package.json`
- Modify: `scripts/test.mjs`

**Interfaces:**
- Produces `test:scripts` for repository `.mjs` tests only.
- Produces `test:ui-parity:only` for Playwright without an implicit build.
- `test:gate` becomes sequential: static checks -> repository scripts -> coverage -> build -> Playwright-only.
- `prepack` builds the publish payload; `prepare` and `prepublishOnly` are absent.

- [ ] **Step 1: Add a scripts-only suite to `scripts/test.mjs`**

When `suite === 'scripts'`, skip TypeScript product-test collection and execute `scripts/test/*.test.mjs` once.

- [ ] **Step 2: Update package scripts**

Add `test:scripts`, add `test:ui-parity:only`, make `test:ui-parity` a developer convenience wrapper that builds then runs Playwright-only, change `test:gate` to avoid `npm test`, and replace `prepare`/`prepublishOnly` with `prepack: npm run build`.

- [ ] **Step 3: Re-run contract tests**

Run: `node --test scripts/test/quality-gate.test.mjs`

Expected: workflow-related assertions remain RED; package lifecycle/script assertions turn GREEN.

### Task 3: Parallelize quality-gate workflow

**Files:**
- Modify: `.github/workflows/quality-gate.yml`

**Interfaces:**
- Static job runs format, lint, typecheck, repository script tests.
- Node coverage job installs Linux sandbox dependencies then runs Node coverage.
- Web coverage job runs React/Vitest coverage.
- Build/browser job builds once then runs Playwright-only.
- Windows portability job runs normal tests and production build.

- [ ] **Step 1: Replace the OS matrix with focused jobs**

Each job checks out and installs with `npm ci --ignore-scripts`. Only the Node coverage Linux job installs sandbox dependencies; only the browser job installs Chromium.

- [ ] **Step 2: Preserve cancellation and timeouts**

Keep `cancel-in-progress: true` and 30-minute per-job timeouts.

- [ ] **Step 3: Re-run contract tests**

Run: `node --test scripts/test/quality-gate.test.mjs`

Expected: quality-workflow assertions GREEN; release assertions remain RED.

### Task 4: Make release trust exact-SHA quality evidence

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Requires `actions: read`.
- Resolves `RELEASE_SHA` from checkout.
- Queries `repos/$GITHUB_REPOSITORY/actions/workflows/quality-gate.yml/runs` using `head_sha=$RELEASE_SHA`.
- Accepts only a completed successful `push` run.
- Installs with `npm ci --ignore-scripts` and publishes once; no Playwright installation, explicit build, or `npm run test:gate`.

- [ ] **Step 1: Add exact-SHA quality verification**

Use `gh api` + `jq` to count successful push-triggered quality runs for the release SHA and exit non-zero when the count is zero.

- [ ] **Step 2: Remove duplicate release work**

Remove Playwright installation, explicit quality gate, and explicit build. Publish uses `prepack` to build once.

- [ ] **Step 3: Re-run contract tests**

Run: `node --test scripts/test/quality-gate.test.mjs`

Expected: PASS.

### Task 5: Full verification and PR

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run repository checks**

Run: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:scripts`, `npm run test:coverage`, `npm run build`, and `npm run test:ui-parity:only` where the execution environment supports dependencies/browser setup.

- [ ] **Step 2: Review the diff**

Confirm no coverage thresholds were relaxed, no release provenance was removed, and every workflow command maps to an existing package script.

- [ ] **Step 3: Open PR**

Create a PR from `ci/optimize-quality-gate-release` to `main` summarizing duplicate work removed and expected timing improvements. Check the new GitHub Actions run and cancel any superseded run if one remains in progress.