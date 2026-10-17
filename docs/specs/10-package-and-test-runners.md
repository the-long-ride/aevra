# Package and Test Runner Boundaries

**Audience:** maintainers and AI agents · **Scope:** npm runtime files, Node test-runner temp storage, and release CI · **Verified against:** `1.3.0`

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

## GNOME Wayland acceptance and companion packaging

The helper-change quality gate runs `helper/tests/run-wayland-gnome.sh` on Ubuntu 24.04 with GNOME Shell, GTK3, AT-SPI and private D-Bus/runtime directories. Missing native prerequisites fail the job. Standalone CI invokes the canonical fixture through its generated overlay with `AEVRA_WAYLAND_MANIFEST` and `AEVRA_WAYLAND_PACKAGE=aevra-desktop-helper`. Actual Unicode text, chords, button clicks, scrolling, isolated pixels under an occluder, focus/target refusal and explicit pause/regrant/reconnect are exercised.

`helper/wayland/package-companion.py` produces a reproducible Linux ZIP containing only production metadata, extension, policy and pixel-capture modules. Test-only controls are excluded. Both Linux release flows include the ZIP and require human installation/enablement and helper-path approval. Native local evidence covers GNOME 50; GNOME 46 CI has not run locally. Production panel approval, actual session lock and bus-disconnect teardown have policy/source coverage rather than native fixture acceptance.

## Release CI

Quality gate runs for pull requests, pushes to `main`, and manual dispatch.
On a pull request a `changes` job (`scripts/ci-changes.mjs`) diffs against the
base commit and maps files to areas: `node`, `web`, `extension`, `helper`.
Static checks always run; each other job runs only when its area changed.
Docs-only changes run static checks alone, `docs/user-manual` counts as `node`
because core tests and the package read it, and workflow, dependency, build
config or unknown paths run every job. Pushes to `main` and manual runs always
run every job. A final `Quality gate result` job fails when any job failed or
was cancelled; it is the one check branch protection should require, because
a skipped matrix job never reports its per-OS check names.

Tag releases only on commits pushed to `main`: other branch pushes no longer
start a run, and the release accepts push runs only. A release waits up to
120 minutes for a completed successful push-triggered run on the exact commit
being released, then uses that run's artifacts. Missing and in-progress runs
remain pending during the wait; a completed failure stops the release. Review
approval is not checked. Pull-request runs validate GitHub's synthetic merge
commit, so they do not replace the push run for the exact tagged commit.

**Boundaries:** this spec documents workflow ordering and CI artifact matching. Publishing permissions and npm identity configuration remain in GitHub and npm settings.

**Related:** [`01-system-overview`](01-system-overview.md) · [`06-workspaces-execution`](06-workspaces-execution.md) · [`GUIDELINE.md`](../../GUIDELINE.md)

KDE CI uses Ubuntu 26.04 and `helper/tests/run-wayland-kde.sh` against KWin 6.6. The source companion archive builds production with `AEVRA_NATIVE_FIXTURE=OFF`; the private fixture builds a separate ON plugin. Both repositories exercise actual software-rendered window capture/input and held-button disconnect. GPU capture acceptance remains outstanding. Persisted consumed nonces prevent restart from restoring a revoked grant.

The canonical helper now has a library and thin stdio binary. Standalone consumes the prepared path dependency and includes the helper as a workspace member; `cargo test --workspace --locked` runs its library and external-consumer contract tests. Native acceptance commands select `-p aevra-desktop-helper` so extraction cannot silently turn a native test invocation into zero tests. `scripts/check-pins.mjs` validates the real library boundary rather than mirrored native dependencies; `library-boundary.test.mjs` and overlay tests cover clean preparation. Root helper CI installs stable Rust with rustfmt and Clippy, runs `cargo fmt --check` and `cargo clippy --all-targets --locked -- -D warnings`, then retains the release build/test and native acceptance steps. Root helper CI installs stable Rust with rustfmt and Clippy, runs `cargo fmt --check` and `cargo clippy --all-targets --locked -- -D warnings`, then retains the release build/test and native acceptance steps. Strict Clippy applies to canonical source without blanket mounted-module allowances.

## Node and standalone release contract

All three repositories select Node.js 24 via `.node-version`; root and standalone Browser declare `>=24.0.0` in package/lock metadata. Desktop uses Node 24 for its source-preparation and validation scripts; its application remains a native Rust binary. GitHub-maintained actions use `@v6`, including setup-dotnet where needed; Swatinem/rust-cache retains its independently versioned `@v2`.

Standalone CI supports push, pull request, manual dispatch and reusable invocation. Releases support version tags and manual selection of an existing tag. `scripts/release-target.mjs` validates tag syntax, source version and exact checked-out tag SHA before emitting `release-tag`/`release-sha`. The release's reusable CI and packaging/publishing checkouts consume that SHA; write permissions are scoped to publishing jobs. Browser publishes npm with provenance plus extension ZIP/checksum assets; Desktop retains six platform archives, license notices and SHA256 sidecars. No release is published from a normal branch push. Root's existing exact-commit quality/artifact release chain remains unchanged.

Workflow/target regression tests cover unsafe, missing, mismatched-version and wrong-checkout tags with a private Git fixture; normal CI runs these contracts so trigger/runtime drift fails validation. Local validation does not dispatch hosted runners or publish packages.

The root formatter treats `llm.txt` as Markdown explicitly; it does not apply that parser to CMakeLists.txt or generated text caches. Local `current-work-*.md` trackers and the commit-excluded planning note are outside the formatting gate. Other repository Markdown and source files remain checked.

The root formatter treats `llm.txt` as Markdown explicitly; it does not apply that parser to CMakeLists.txt or generated text caches. Local `current-work-*.md` trackers and the commit-excluded planning note are outside the formatting gate. Other repository Markdown and source files remain checked.

Node coverage compiles the security regression fixtures through `tsconfig.coverage.json` before executing batches. Desktop driver fakes accept the real authorized capture/describe arguments; gate tests use the current `input` direction and assert non-null window results before dereferencing. A successful product-only typecheck does not replace this test compilation.

macOS helper and standalone build jobs select an installed Xcode 26+ using canonical `helper/setup-macos.mjs`, check SDK version and actual Metal declarations, and persist `DEVELOPER_DIR`/`SDKROOT` for following Cargo steps. Root and standalone Cargo configs add `/usr/lib/swift` rpath to Rust consumers because dependency build-script link arguments do not propagate to them. This is a build prerequisite, not native macOS runtime acceptance.

Standalone's dedicated Windows background acceptance compiles both the Rust test and a fresh .NET fixture with the runner account before changing identities. It passes the prepared fixture directory to the test, so the standard account only executes the fixture and needs no SDK restore/build state. Build errors remain visible and stop execution before temporary-account creation. A non-elevated local host uses the restricted-token path. An elevated GitHub host creates a temporary standard account and uses a real profile-loading logon on the same desktop, because SAFER filtering can preserve elevation metadata. It grants only the temporary SID desktop access, source read and build-folder modify access, verifies the suspended child token before resuming it, propagates the test exit code, and removes account/ACL grants in cleanup. Mocked launcher tests cover exit propagation, generated script syntax, cleanup on logon failure and refusal to create accounts outside hosted CI. Required native execution fails when fixture build prerequisites are missing; production elevation/UIPI guards are unchanged. WebView2 handler fixtures use separators recognized by both native platform path rules.
