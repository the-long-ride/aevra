# CI and Release Test Optimization Design

## Goal

Reduce Aevra quality-gate and release wall-clock time without weakening the 85% coverage requirement or cross-platform validation.

## Design

### Release lifecycle

Release jobs must not execute the full quality gate again. A release resolves the checked-out/tagged commit SHA and verifies that the exact SHA already has a successful `quality-gate.yml` run from a `push` event. If no successful run exists, publishing stops with a clear error.

The release then installs dependencies with lifecycle scripts disabled and calls `npm publish`. Package build moves from `prepare` to `prepack`, so dependency installation no longer builds the project and publishing builds the package exactly once. `prepublishOnly` no longer reruns `test:gate`.

### Quality-gate execution

Product tests should execute once per Linux gate path:

- Node TypeScript tests execute under V8 coverage and retain 85% thresholds for lines, statements, functions, and branches.
- React/Vitest tests execute under coverage instead of first running without coverage.
- Repository script/contract tests execute once separately because they are not part of product coverage instrumentation.
- The production build executes once and Playwright reuses that build through a Playwright-only script.

The local `test:gate` remains a sequential full-gate command for developer use, but removes duplicate normal test executions.

### GitHub Actions parallelism

GitHub Actions splits independent Linux validation into parallel jobs:

1. Static/repository checks: formatting, linting, type checking, and repository script/contract tests.
2. Node coverage: Node product tests with required sandbox/container setup.
3. Web coverage: React/Vitest coverage.
4. Build and browser parity: one production build followed by Playwright without rebuilding.
5. Windows portability: normal product/repository tests plus a production build, without repeating Linux coverage, lint, formatting, or browser setup.

Workflow concurrency continues to cancel superseded PR/main quality runs.

### Release verification

`release.yml` gets `actions: read` permission and queries GitHub Actions for completed runs of `quality-gate.yml` whose `head_sha` equals the release SHA, `event` is `push`, and `conclusion` is `success`. This prevents an unvalidated tag/manual target from being published while avoiding a second gate.

## Compatibility and safety

- Node stays on version 24.
- Linux and Windows remain represented in CI.
- Coverage remains >=85% for all four configured metrics.
- Trusted npm publishing/provenance remains unchanged.
- Existing developer-facing `npm test` remains available.
- Release fails closed when exact-SHA quality evidence is missing.