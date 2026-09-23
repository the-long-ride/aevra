# Package and Test Runner Boundaries

**Audience:** maintainers and AI agents · **Scope:** npm runtime files, Node test-runner temp storage, and release CI · **Verified against:** `1.1.2`

## Published npm runtime

The root package builds the CLI and web application in `prepack`. The `bin.aevra`
entry points at `dist/apps/cli/src/cli.js`. The package `files` allowlist must
include every compiled directory that a shipped JavaScript file imports at
runtime, including packages used by the worker and MCP tools.

`npm run test:package` builds no source itself. After a build, it packs the
current tree, installs the tarball into an isolated temporary prefix, checks
relative JavaScript imports throughout the installed `dist` tree, and runs the
installed CLI's `--version` command. `test:gate` and `test:portability` run this
check after the production build.

## Node test-runner temporary files

The normal and Node coverage runners create one private directory for each
invocation. Child test processes receive that directory through `TEMP`, `TMP`,
and `TMPDIR`. The runner removes only its own directory after normal completion,
test failure, compilation failure, or coverage-report failure; it preserves the
original nonzero result when cleanup also fails. Compilation and coverage
outputs remain in their existing repository-local directories.

On macOS, the private root is created under /tmp with a short prefix. The
default /var/folders/... path becomes too long once nested IPC socket directories
are added, because Unix-domain socket paths have a fixed platform limit.

This cleanup boundary applies to the repository runners, not to an individual
test file launched directly. Forced process termination cannot guarantee
cleanup, and a later run does not sweep another invocation's directory.

## Release CI

Quality gate runs for every branch push and pull request. A release waits up to
120 minutes for a completed successful push-triggered run on the exact commit
being released, then uses that run's artifacts. Missing and in-progress runs
remain pending during the wait; a completed failure stops the release. Review
approval is not checked. Pull-request runs validate GitHub's synthetic merge
commit, so they do not replace the push run for the exact tagged commit.

**Boundaries:** this spec documents workflow ordering and CI artifact matching. Publishing permissions and npm identity configuration remain in GitHub and npm settings.

**Related:** [`01-system-overview`](01-system-overview.md) · [`06-workspaces-execution`](06-workspaces-execution.md) · [`GUIDELINE.md`](../../GUIDELINE.md)
