# Changelog

## [1.1.0] - 2026-09-21

### Added - Structured Command Understanding, Workspace Scope & Typed Rules

- **Keep-awake reliability**: Windows now reasserts the system-required execution state every 30 seconds and treats a zero API result as failure; Linux now inhibits both idle and sleep through logind so active keep-awake policy cannot silently allow suspension.

- **Structured Command Analysis & Graph Generation (`packages/command-analysis`)**:
  - Replaced legacy string-based wildcard collapsing (`shell:<kind>:*`) with versioned, structured semantic command analysis (`CommandAnalysis`, `CommandNode`).
  - Added bounded shell parsing adapters for PowerShell (`pwsh` and Windows PowerShell 5.1), CMD, Bash, `sh`, and `zsh`, emitting explicit nodes, source spans, and graph edges (`sequence`, `success`, `failure`, `pipe`, `subshell`) without executing script text.
  - Safe analysis bounds: max 64 KiB script text, 256 nodes, 4 nested shell depth, 32 cwd alternatives, and 1500 ms parse budget returning `ANALYSIS_LIMIT` rather than truncating into an allowed command.
  - Transparent nested shell recursion recognizing `-Command`, `-c`, `-lc`, and CMD `/c` with dialect-specific parsing.
  - Explicit diagnostic reasons (`PARSE_INVALID`, `UNSUPPORTED_SYNTAX`, `DYNAMIC_SCOPE`, `OUTSIDE_WORKSPACE`, `TOOL_NOT_FOUND`, `EXECUTABLE_CHANGED`, `SCRIPT_CHANGED`, `UNKNOWN_OPTION`, `CONTEXT_CHANGED`).

- **Application & Wrapper Semantic Adapters**:
  - **Git adapter (`applications/git.ts`)**: extracts global options before subcommands, repeated `-C` transitions, `--git-dir`, `--work-tree`, and distinguishes mutations (`branch -D`, hard reset, push force/force-with-lease, clean) from read-only operations (`status`, `diff`, `log`, `show`, `branch` list).
  - **Node Packages adapter (`applications/node-packages.ts`)**: supports `npm`, `pnpm`, `yarn`, and `bun`, differentiating exact named scripts (`run <script>`), audit inspection vs `audit --fix` mutation, and target directories via `--prefix`, `--dir`, and `-C`.
  - **RTK Wrapper adapter (`applications/rtk.ts`)**: recognizes documented RTK command mappings (`rtk git ...`, `rtk npm ...`, `rtk tsc`, `rtk lint`, `rtk prettier`, `rtk jest`, `rtk vitest`, `rtk cargo ...`, `rtk dotnet ...`, `rtk deps`, `rtk env`), retaining wrapper identity and mapping version while delegating to underlying application semantics. Unknown RTK mappings remain explicit and unprivileged.
  - **Generic & Builtin adapter (`applications/generic.ts`)**: tracks directory change builtins (`cd`, `chdir`, `Set-Location`, `pushd`), standard read utilities (`cat`, `ls`, `grep`, `rg`), and filesystem mutation tools (`rm`, `rmdir`, `mkdir`, `cp`, `mv`).

- **CWD Flow & Canonical Workspace Scope Enforcement**:
  - Full propagation of optional `cwdLogical` through command and process inputs, resolving logical paths against authorized capability roots instead of hardcoding root `/`.
  - Tracks branching working directory changes across success (`&&`) and sequential (`;`) execution paths.
  - Detects targets from options, redirects (`>`, `>>`), operands, and environment overrides.
  - Canonicalizes paths in backend namespace, enforcing containment boundaries against sibling-prefix attacks and symlink escapes (`OUTSIDE_WORKSPACE`).
  - Identifies dynamic or unresolvable scope (`DYNAMIC_SCOPE`) requiring explicit human approval.

- **Typed Command Rules (V2) & Migration 016**:
  - Schema migration `016_command_rule_v2_predicates`: added `version`, `predicate_json`, and `status` columns to `permission_rules`.
  - Automatic migration of narrow legacy permissions (`git:status:*`, `npm:run:<script>:*`) into typed `CommandRuleV2` predicates with application, operation, scriptName, allowed modifiers, positional constraints, dialects, and backends.
  - Broad legacy wildcards (such as `shell:*`) remain preserved with `status: 'needs-review'`, preventing unintended broad V2 unattended execution authority.
  - Conservative preservation of legacy DENY coverage.

- **Unified Command Decision Engine & Exact Approval Binding**:
  - Pure `decideCommand` policy implementation evaluating authority, selected DENY, critical policy (`policy.critical.alwaysConfirm`), scope status, script trust, network authority, and typed predicates.
  - Enforced policy table: workspace YOLO auto-allows every non-critical command whose analysis stays inside the workspace; unrestricted YOLO removes the Aevra workspace authorization boundary for non-critical commands. Active in-scope YOLO overrides remembered command/network DENY rules, while invalid authority/requests remain blocked and CRITICAL commands always require fresh local confirmation.
  - Atomic approval binding (`apps/core/src/approvals/command-binding.ts`): binds pending tickets to exact request fingerprints and evidence fingerprints, preventing ticket reuse across arguments or stale contexts (`APPROVAL_ALREADY_CONSUMED`, `CONTEXT_CHANGED`).
  - Project script trust evaluation (`script-trust.ts`): fingerprints named script definitions and lifecycle hooks; changes to script definitions invalidate remembered approval (`SCRIPT_CHANGED`).

- **Executable Identity Binding & Windows Batch Shim Safety**:
  - System capability detection now includes GitHub CLI (`gh`) and GitLab CLI (`glab`) in the Source control group alongside Git.
  - Host policy analysis resolves the actual invocation through `packages/command-analysis/src/executable-resolver.ts`, including explicit paths, request PATH/PATHEXT overrides, canonical identity, wrapper fingerprints, and provenance. Execution prepares Windows launch targets through `packages/executor/src/spawn-target.ts`; sandbox analysis fails closed when backend-native executable identity is unavailable rather than reusing host evidence.
  - Safe Windows batch shim execution with `windowsShimCommand` across both managed processes and direct commands (`runCommand`), preventing CVE-2024-27980 command injection risks without falling back to generic `shell: true`.
  - Added RTK to logical tool catalog in `capability-detector.ts`.

### Fixed - Authorization Freshness, Shell Scope & Local CLI Reliability

- **Command scope and parser hardening**:
  - Logical command working directories are now mapped through capability roots independently from native absolute command operands, preventing the workspace logical root from being confused with the host filesystem root.
  - Nested shell analysis preserves the outer launcher identity and its redirections; Bash background lists using single `&` expose both commands to policy evaluation; malformed quoting and unsupported value-bearing filesystem options fail closed.
  - Filesystem scope extraction now includes path-bearing options such as copy/move target directories, grep/ripgrep pattern files, touch reference files, and find input lists.
  - Package-script evidence resolves the canonical package working directory once, including mounted roots and `--prefix`/`--dir`/`-C`, so script fingerprints describe the package actually executed.

- **Approval and network freshness**:
  - Exact command approval bindings now include canonical cwd/target identities, executable and wrapper canonical paths, root/backend/policy/environment/resolver revisions, and script evidence.
  - Approval resume re-evaluates the current network destination policy and rejects newly denied destinations rather than replaying stale network authority.
  - Runtime-session command explain/evaluation now carries the same classified risk floor and live network decision used by execution, including CRITICAL risk.

- **Local Admin CLI and service reliability**:
  - Successful Admin logins no longer consume failed-login rate-limit capacity. Rejected login bursts still return `429` with retry timing.
  - CLI Admin failures now distinguish authentication/rate-limit failures from transport failures instead of always suggesting the Core is stopped.
  - Windows `aevra service start` and `restart` now preflight service installation and direct the operator to `aevra service install` when the Scheduled Task is absent.
  - Added CLI coverage for durable OAuth connections (`aevra connections list|revoke`), live session maintenance (`aevra sessions list|revoke|revoke-others`), upstream MCP management with aligned table output (`aevra mcp list`), audit clearing, and `aevra about` metadata output formatted as an aligned table with an updated capabilities description and no note line.

- **Admin API & Web UI Enhancements**:
  - Reworked data-table controls so search, filters, row count, and toolbar pagination form a compact responsive control strip; Live MCP activity now keeps pagination with its filters, and mobile health chips align to the right.
  - Replaced the static MCP upstream list in Settings (`McpUpstreamsSettings`) with a full-featured paginated `DataTable` supporting search, status/transport/risk filters, configurable page size (5 to 100), and integrated server actions.
  - Corrected author note from `make by <3` to `made by <3` across `@aevra/admin-contracts` and the Web UI About page, while removing the redundant standalone Note row.
  - Fixed the dashboard request-activity chart to render every integer request-count level on the same Y transform as the activity line, and start authenticated realtime activity streaming immediately after Web UI login without requiring a page refresh.
  - Added authenticated `POST /api/policy/commands/explain` endpoint for non-executing preview and policy explanation.
  - Added `CommandExplanation` UI component in `RequestApprovalModal` showing visual breakdown of application, operation, shell dialect, effective CWD, outside targets, and reason codes.
  - Added `CommandRuleEditor` for authoring and previewing typed `CommandRuleV2` rules.
  - Added `Status` column in `PermissionsPage` distinguishing active, v2, and `needs-review` rules.
  - Reconciled workspace-default YOLO mode across Admin API and runtime helper (`normalizeYoloMode`).

## [1.0.5] - 2026-09-18

### Added - Background Desktop Automation (Windows)

- **Background semantic operations without input injection**:
  - Implemented semantic action tools: `desktop_invoke`, `desktop_set_value`, `desktop_select`, `desktop_toggle`, and `desktop_release_window`.
  - Added `mode: 'background'` to `desktop_describe` with automatic acquisition of 60-second exclusive window leases (`windowLeaseId`).
  - Zero foreground interference: operates purely via Windows UI Automation pattern interfaces (`IUIAutomationInvokePattern`, `IUIAutomationValuePattern`, `IUIAutomationSelectionItemPattern`, `IUIAutomationTogglePattern`), never invoking `SendInput`, `SetCursorPos`, `SetFocus`, clipboard modifications, or window activation.
- **Window lease and snapshot lifecycle isolation**:
  - Window leases are bound strictly to the verified worker session and workspace (`sessionId`, `workspaceId`).
  - Single-snapshot invalidation: every mutating background action invalidates the snapshot immediately, preventing stale handle reuse across state changes.
  - Expiring lease TTL (60 seconds) with explicit release support (`desktop_release_window`).
- **Focus change detection and native target security**:
  - Monitors active foreground window across actions: if focus changes or a modal dialog appears, the lease is suspended and subsequent actions fail with `DESKTOP_FOCUS_CHANGED` until re-described.
  - Native target security pre-checks: validates target process creation time, token elevation, token integrity levels, and desktop station (strictly refuses Winlogon, Screen-saver, UAC secure desktops, and higher-integrity targets).
  - Unattributed windows are strictly refused for background automation.
  - Protected password controls return masked values and refuse background input; read-only controls refuse `desktop_set_value`.
  - Audit logging and approval prompts sanitize `desktop_set_value` values to prevent secret leakage in logs, storing only value lengths with unique request nonces.
- **Native coexistence test fixture and probe**:
  - Added Windows test fixture (`helper/tests/fixtures/background-controls`) and integration suite (`packages/desktop/test/background-native.integration.test.ts`) proving simultaneous coexistence with an active foreground sentinel window without cursor movement or keystroke leakage.
  - Added `scripts/desktop-background-probe.ps1` and research report `docs/research/2026-09-18-quotashift-background-compatibility.md` detailing QuotaShift tray minimization findings and WebView2 accessibility requirements.

### Added - Floating-IP OAuth connection continuity & runner lease persistence

- **Floating-IP OAuth runner continuity**:
  AI web providers (such as OpenAI ChatGPT and Anthropic Claude) dispatch requests across transient cloud runner VMs with dynamic egress IPs. Aevra now decouples connection authority from transient IP addresses: any runner VM presenting a valid OAuth bearer token retains its explicit connection-level workspace authority without operator re-admission.
- **Durable multi-workspace connection grants**:
  OAuth connections can now hold multiple durable workspace grants concurrently (`oauth_connection_workspace_grants`). Grants can be added or revoked offline from the Admin UI even when no active sessions are attached. Revoking one workspace grant preserves sibling grants.
- **Atomic approval execution claims**:
  Pending approvals record the owning connection subject (`connectionSubject`). Resuming an approved ticket (`approval_wait`) claims execution atomically in the database (`claimExecution`), guaranteeing at-most-one execution across concurrent runner VMs. Unauthorized callers attempting resumption receive `APPROVAL_UNAUTHORIZED` without modifying the ticket's state, preventing ticket poisoning attacks.
- **Separated rate-limiting boundaries**:
  Token bucket rate limiters are partitioned into three independent pools:
  1. Shared connection limiter (120 capacity, 20/s refill) for authenticated OAuth requests across rotating runner IPs.
  2. Independent invalid-bearer limiter (30 burst, 1/s refill) returning `429` with `Retry-After` on unauthenticated or malformed tokens, protecting valid connections and connectors from quota exhaustion.
  3. Static connector rate limiter for URL-based and Bearer-token connector credentials.
- **Bounded runner origin visibility and immutable provenance**:
  Incoming requests capture immutable execution provenance (`remoteIp`, `userAgent`, `requestId`) in audit records. The Admin UI renders the last 10 unique runner IPs per connection subject with relative timestamps from `oauth_connection_origins` (pruned after 24 hours).
- **Interactive delete confirmations across Web UI**:
  Standardized `[x]` danger-button controls with interactive confirmation dialogs for all removal actions across the Web UI, including revoking workspace grants and disconnecting connectors.

### Added - Web UI, data management, and settings enhancements

- **Universal switch toggles across Web UI**:
  Replaced all legacy HTML checkboxes with accessible `<Switch>` button toggles across the application:
  - Active Connections table in the Dashboard (`Select` column).
  - Data export and import tables (`DataPage`).
  - Request Approval modal (`Remember decision for this workspace`).
  - Desktop App Picker table (`DesktopAppPicker`).
  - Desktop Control settings toggles (capability permissions and unattributed window access in `DesktopControlSettings`).
- **Responsive edge-to-edge Request Activity timeline**:
  Updated `RequestActivityChart` to dynamically observe viewport container width using `ResizeObserver` instead of fixed pixel widths, ensuring the activity chart spans full width on high-resolution displays.
- **Anchor-aligned dropdown positioning**:
  Fixed upward-opening positioning calculations in `Dropdown` and `SearchableMultiSelect` by anchoring to the trigger rectangle's bottom coordinate, eliminating floating or detached menus when selecting workspaces or filtering lists.
- **Browser extension detection and status monitoring**:
  - Content script presence detection (`content-detect.ts`) verifies whether the Aevra extension is actively loaded in the browser.
  - Live top-bar badge chip displays real-time connection status with a green indicator dot when connected and red when disconnected.
  - Added version mismatch detection and warning banner in `BrowserSetupModal` prompting operators to update their extension when versions diverge.
  - Multi-size branding icon assets generated in 16x16, 32x32, 48x48, and 128x128 formats for the extension package.

- **Data backup and import tab (`/api/data/export` & `/api/data/import`)**:
  A new top-level **Data** tab in the Web UI allows operators to download a complete
  JSON backup of their Aevra configuration (workspaces, external mounts, permission rules,
  command-family overrides, network rules, environment profiles, secret references,
  lifecycle hooks, MCP upstream servers, desktop policy, and custom apps).
  Machine-specific environment variables and device-bound secrets are intentionally
  excluded to ensure safe portability. Backups can be uploaded, previewed with itemized
  entity counts, and restored directly through the UI.
- **Desktop control custom apps management**:
  The `Apps computer use can touch` setting now uses a terminal console-style segmented
  control (`Allow all apps`, `Only these apps`, `Deny all apps`). Under allowlist mode,
  detected applications are presented in a compact, searchable, filterable, sortable,
  and paginated table. Operators can add custom applications with explicit executable file
  paths and optional version tags via `AddCustomAppModal`, and edit or delete them
  directly in the table.
- **Console-styled segmented radio controls**:
  Standardized terminal aesthetic radio buttons (`.console-radio-group` / `.console-radio-option`)
  for policy selectors, including `Local pages (localhost and 127.0.0.1)`, `Apps computer use can touch`,
  and `YOLO policy`.
- **YOLO policy section UX and relocation**:
  The YOLO policy setting has been redesigned into a segmented console radio control
  (`Workspace YOLO`, `Unrestricted YOLO`, `YOLO disabled`) with immediate persistence,
  and relocated to sit directly after `Secret references` for clearer administrative flow.
- **Standardized `[x]` delete controls and mandatory confirmation dialogs**:
  Every delete, remove, and revoke button across the entire Web UI now renders with the
  compact `[x]` label with semantic `danger-button` styling and explicit `aria-label`/`title`
  tags for accessibility. All deletions (workspaces, mounts, secret references, lifecycle hooks,
  network rules, command-family overrides, MCP upstream servers, permission rules, remote
  sessions, local admin sessions, custom desktop apps, and managed processes) strictly
  require confirmation via an interactive modal before executing.
- **Workspaces SVG action icons**:
  Workspaces table action buttons now use crisp terminal-style SVG icons for copying paths
  and viewing details.
- **UI performance and selection enhancements**:
  Memoized the `Show file paths to the AI` control to eliminate cascade re-renders across
  surrounding settings panels, routed success notifications through toast messages with the
  `// ` prefix, and preserved native text selection throughout table and settings copy.

### Added - desktop control (Windows)

- **Desktop control (Windows only)**: ten `desktop_*` MCP tools let an agent
  read the windows that are open, read one window's accessibility tree, take a
  screenshot, and click, type, press keys, and scroll - through the same
  capability, risk, approval, DLP, and audit gate that governs files, commands,
  and the browser. Gated by a new `desktop.control` capability, off by default
  and not implied by any other capability. macOS and Linux are not implemented:
  there is no helper binary for them, so `desktop_connect` there reports
  `DESKTOP_HELPER_NOT_INSTALLED`.
- **Tree-first perception**: `desktop_describe` returns named elements as
  `ref_<generation>_<index>` handles and `desktop_click` takes a ref, so a task
  costs a fraction of a screenshot-per-step loop. `desktop_capture` returns
  pixels only when asked, as a size-capped JPEG. A ref from an earlier describe,
  or from before a helper restart, is refused as `DESKTOP_REF_STALE` rather than
  rebound to whatever now occupies that index. Every action returns a delta
  (`focusChanged`, `newWindow`, `subtreeChanged`) so the screen need not be
  re-read after each step.
- **Reads and input fail differently, on purpose**: screen reading is always
  permitted; input is refused whenever Aevra cannot say which application would
  receive it. A window whose owning executable cannot be read - the secure
  desktop, a UAC consent prompt, some elevated processes - is `unattributable`
  and gets no input unless the policy opts in with
  `unattributedInput: 'allow'`. The default policy also denies input to
  terminals, password managers, and credential dialogs. Input into a more
  privileged window is refused by Windows itself (UIPI) and is reported as
  `DESKTOP_INPUT_REFUSED`, never as success.
- **A local helper process**: a Rust binary supervised over line-delimited JSON
  with a deadline, a restart, and a generation counter that invalidates every
  outstanding element reference when it restarts. It reports four independent
  capabilities at connect - `capture`, `tree`, `attribution`, `input` - so the
  model learns what the host can do once instead of discovering it through
  failures.
- **Desktop DLP and audit**: typed text never reaches the audit log or an
  approval row, only its length; screenshots are audited by content hash and
  never persisted; window titles and accessible names pass through redaction and
  are marked untrusted; every action records the gate verdict and the deciding
  rule, reads included.

### Added - workspace manifest

- **aevra.json**: a workspace can declare its own build/test commands and its
  own protected paths (`protectedPaths.sensitive` / `protectedPaths.secret`, a
  small auditable glob dialect). Declared paths are enforced by the same
  sensitivity machinery as the built-in `.env`/`id_rsa`/`.pem` rules, on reads
  and on search hits as well as on mutations. `aevra.json` protects itself, so
  an agent cannot disarm the file by overwriting it.

### Added - MCP upstream servers

- **MCP upstream proxy**: operators can register HTTP, SSE, or stdio MCP
  servers from the Admin UI or `aevra mcp`, with credentials referenced by
  secret id rather than stored in a tool or catalog response. Upstream tools,
  prompts, and resources are republished under collision-resistant namespaced
  names, while upstream calls remain workspace-scoped and audited.
- **Catalog review and degraded state**: a server is connected and its catalog
  is fingerprinted before registration is stored. Temporary outages keep the
  server visible as degraded; a changed catalog moves to Needs review and stops
  serving until an operator acknowledges the added, removed, and changed
  entries. Upstream `readOnlyHint` and `destructiveHint` annotations are shown
  as advisory only and cannot lower the configured risk tier.
- **Safe reconnect behavior**: a dropped upstream call fails rather than being
  silently replayed. Reconnect validates the catalog before serving calls again;
  sampling is not proxied.

### Security - review follow-ups

- **Desktop input is approval-gated.** `desktop_click` is MEDIUM, `desktop_type`
  and `desktop_key` are HIGH, and all three now reach an approval instead of
  running unattended for the life of a `desktop.control` lease.
  `desktop_scroll` stays LOW. The window gate answers which window may receive
  input; it never answered whether the input should happen at all.
- **The browser origin policy covers Aevra off loopback.** The rule blocking
  Aevra's own listener ports applied only to loopback origins, so the same
  admin surface reached over a LAN address, the public gateway, or a managed
  tunnel classified NORMAL and was drivable. The port rule is now
  unconditional, and every origin Aevra is currently reachable at is blocked by
  hostname, read live from exposure config rather than stored.
- **Declared protected paths reach the executor.** `file_search` and `search`
  authorize their search root, then let the executor classify each hit - which
  knew only the built-in rules. A workspace's declared globs now travel with
  the read operation, so a declared-SECRET file is no longer returned as an
  ordinary search hit.
- **Protected-path matching is spelling-independent.** Patterns were tested
  against the raw path a tool call supplied, so `./aevra.json`,
  `sub/../aevra.json` and `aevra.json/` all evaded a glob that `aevra.json`
  matched. Paths are normalised before classification.
- **Typed text is scanned for secrets.** `browser_act_many`'s `type` and
  `select` values go through the same DLP pass as a navigation URL; typing a
  secret into an attacker's form was the same exfiltration a URL scan exists to
  stop.
- **The extension socket bounds a frame.** A declared 64-bit frame length is
  capped and an over-cap frame drops the socket, rather than buffering whatever
  the peer claims is coming.

### Known limitations - desktop control

- The helper binary is unsigned. The protection for Aevra's own admin UI is
  also partial: that UI is a web page, so at window granularity its identity is
  the browser's process; the mitigation is an exact window-title refusal, which
  a page can influence and which is blind to a background tab. Keep approvals
  on a device the agent is not driving.
- `desktop_capture` maps to clickable coordinates only for the primary monitor;
  the result carries no origin, so window and secondary-monitor captures cannot
  be turned back into coordinates.
- No human-takeover abort, and no per-click approval prompt.

### Added - browser control

- **Browser control**: nine `browser_*` MCP tools let an agent read pages,
  click, type, and navigate through the same capability, risk, approval, DLP,
  and audit gate that governs files and commands. Two transports share one tool
  surface - the Aevra MV3 extension, which keeps the logged-in sessions you
  already have, and the Chrome DevTools Protocol for a browser you started
  yourself. A single table-driven conformance suite runs against both drivers
  and an in-memory fake, so the transports cannot drift apart in behaviour.
  Gated by a new `browser.control` capability, off by default and not implied by
  `network`.
- **Extension pairing and kill switch**: `Settings → Browser control` mints a
  single-use pairing code and stores a MAC'd token the worker verifies offline.
  **Disconnect all browsers** bumps a revocation epoch that invalidates every
  issued token and drops live sockets immediately, not on the next operation.
- **`aevra extension install [--dir <path>] [--yes]`**: downloads the extension
  archive published for the running version, asks where to unzip it, and prints
  the load-unpacked steps. The extension ships as `aevra-extension.zip` of plain
  compiled JavaScript; there is no `.crx`, because a Chromium browser refuses to
  install one that did not come from its own web store.
- **Browser control discovery**: the web UI shows a prompt beside Requests, and
  `aevra status` reports a line, when no extension is paired. Both stay silent
  when one is paired or when Aevra cannot tell.
- User manual chapter 18, _Browser control_, covers installing the extension,
  choosing the profile it drives, pairing, and the CDP alternative.

### Security

- **Navigation URLs are DLP-scanned across the path**, not only the query and
  fragment. The shared redaction pass grants slash-bearing runs some immunity so
  real filesystem paths survive tool output, which meant a secret placed in a
  URL path passed through; path segments are now judged one at a time.
- **`browser_tabs {action:'open'}` is treated as a navigation.** It sends the
  browser to a URL exactly as `browser_navigate` does, but risk keyed on the
  tool name, so it skipped both the blocked-origin refusal and the DLP scan and
  was tiered LOW. Risk now keys on whether the operation navigates.
- **No page-script evaluation on any transport**, enforced by a source test.
  Credential fields (password, one-time-code, payment) are refused in the page
  and again in the worker, and approval cannot override it. `chrome://`,
  `chrome-extension://`, `devtools://`, `file://`, `view-source:` and Aevra's
  own admin UI are refused outright rather than ticketed.
- **The extension archive is treated as hostile input.** `aevra extension
install` rejects absolute paths, `..` and `.` segments, backslashes, and
  control characters in entry names, resolves every path against the
  destination, verifies entry checksums, and bounds inflation by the size the
  archive declares. Nothing is written until the whole archive has been read and
  validated, and an existing install is removed only after that, so a failed or
  hostile download cannot leave a half-extracted tree or an unpaired browser.

### Fixed

- `RequestActivityChart` is split into geometry, viewport, and rendering, taking
  it from 411 lines to 175.

## [1.0.4] - 2026-08-30

### Added

- **YOLO modes**: unattended automation now has two operator-chosen modes in
  Settings (`policy.yolo`, `GET`/`PATCH /api/policy/yolo`). `workspace` (default)
  auto-runs only work that stays inside the workspace sandbox and still raises an
  approval for host execution, network access, `git.push`, CRITICAL risk, and command
  bodies that elevate privilege, reach a remote host, touch system or home paths,
  change host services or the registry, drive a container or cluster runtime, publish,
  or traverse out of the workspace. `unrestricted` waives that scope check, is
  confirmed in the UI before it applies, and has to be selected
  deliberately; it still honors `policy.critical.alwaysConfirm`. A YOLO session also
  no longer stops for a per-command approval after clearing the capability gate.
- **YOLO policy and onboarding/settings UI integrations**: added full web UI controls
  and regression test coverage for YOLO policy selection and onboarding setup.
- **`git_add` tool**: stages files in the workspace index (`paths` list or `all: true` for `git add -A`). Classified LOW risk with no approval gate, matching the other read-adjacent Git tools.
- **`git_diff` short mode**: optional `short: true` input returns a compact `--stat` summary instead of the full patch text.
- **OAuth secret-persistence regression tests**: assert that access tokens, refresh tokens, PKCE verifiers, and authorization codes never reach durable storage in plaintext, that refresh rotation preserves the invariant, and that tokens stay verifiable from their stored hashes.

### Security

Remediates an internal security audit. Each item carries a regression test in the
`.security.test.ts` suite.

- **Explicit DENY outranks YOLO**: permission rules are now evaluated before the YOLO
  short-circuit in both authorization gates, so a standing DENY refuses the operation
  instead of being skipped by a session flag.
- **Unknown sandbox backend fails closed**: an unset or unreadable
  `execution.settings.sandboxBackend` counts as sandboxed, so a settings gap can no
  longer let host execution run unattended under workspace-scoped YOLO.
- **Escape detection is linear**: the workspace-escape patterns no longer pair two
  tokens across a scan-to-end-of-line, which backtracked quadratically on a
  caller-controlled script body.
- **Slash-bearing secrets are redacted**: the generic entropy rule skipped every
  candidate containing `/`, so a base64 payload with a `/` in it passed through
  unredacted. Slash-bearing runs are now judged per segment - a long or
  mixed-case-with-digits segment is treated as an opaque payload, while ordinary path
  components (including Windows paths) still survive.
- **Client IP is no longer attacker-controlled**: `remoteIp` trusted the
  `cf-connecting-ip` header unconditionally and the public gateway did not strip it,
  so any remote client could mint a fresh rate-limit bucket per request and forge the
  origin address recorded in the audit trail. The gateway now strips
  `cf-connecting-ip`, `true-client-ip`, and `x-real-ip`, and `remoteIp` ignores them
  unless a caller explicitly opts in. `IpRateLimiter` additionally bounds its bucket
  and failure maps with LRU eviction so key cycling cannot exhaust memory.
- **Hardened OAuth client-IP handling, DLP path detection, and approval-modal keyboard focus**:
  prevented IP spoofing, closed DLP evasion paths, and kept keyboard focus trapped within approval dialogs.
- **Shell approvals are one-time only**: the permission matcher `shell:<shell>:*`
  excludes the script body, so approving a single shell command with a persistent
  scope authorized every future script. Persistent scopes are now refused for
  `commands.run` operations whose family begins with `shell:`.
- **Approval previews are trustworthy**: previews left Unicode control and format
  characters intact and truncated shell scripts at 180 characters, so a benign prefix
  plus padding could hide the real payload behind the ellipsis. Previews now strip
  Cc/Cf characters (ANSI escapes, zero-width spaces, bidi overrides), executable text
  gets a 4000-character budget, and any remaining truncation is reported through the
  new `truncated` and `previewFullLength` fields.
- **Workspace instructions are marked untrusted**: workspace `AGENTS.md` reached the
  model as a `role: user` prompt, so a hostile repository could place text in the
  highest-trust position available. Workspace-sourced instructions are now delivered
  inside a labeled untrusted-content envelope that also neutralizes forged
  delimiters. User-global instructions, which the operator authors, are unchanged.
  Command `stdout`/`stderr` is stripped of terminal control sequences.
- **YOLO honors `policy.critical.alwaysConfirm`**: YOLO short-circuited ahead of the
  policy check, contradicting the documented guarantee that critical operations never
  execute unattended. The policy is now evaluated first in both `gated()` and
  `authorizeCapability()`.
- **Admin is not published by default through a tunnel**: the public gateway routed
  every non-MCP path to the Admin plane, so enabling an exposure provider also
  exposed the Admin UI and its login endpoint. Admin proxying now requires either
  local-only exposure or an explicitly configured `adminPublicUrl`; otherwise those
  paths return `404` without reaching the upstream.
- **Destructive commands are classified correctly**: risk classification matched only
  abstract tokens that never appear in real command lines, so a recursive force
  delete of a filesystem root classified LOW. Added patterns for privilege
  elevation, filesystem creation and wipe, raw device writes, power-state changes,
  recursive delete, recursive `chmod`/`chown`, `npm publish`, and
  download-piped-to-interpreter.
- **Dynamic client registration is bounded**: `client_name` is unauthenticated input
  that renders into local approval prompts and OS notifications; it is now stripped
  of control characters and capped at 80 characters. Registration is refused with
  `too_many_clients` beyond 50 registered clients.
- **Admin CSRF checks require positive evidence**: a state-changing request carrying
  neither `Origin` nor `Sec-Fetch-Site` was accepted. Such requests are now accepted
  only from a loopback peer, which preserves the local CLI while closing the
  fail-open path.
- **Connector URL tokens are kept out of caches**: responses on the `/mcp/<token>`
  path set `Cache-Control: no-store`, and a one-time startup warning recommends the
  `Authorization: Bearer` form. Aevra itself never recorded the request path, so no
  audit or activity redaction was required.
- **Workspace read output carries provenance**: `file_read`, `file_search`, and
  `search` results are tagged `untrusted: true` with a notice stating the content is
  data rather than instructions. The marker travels alongside the content instead of
  wrapping it, because `file_read` output doubles as the merge base for `file_patch`
  and rewriting those bytes would corrupt subsequent writes; a regression test pins
  that byte-exactness. `file_search`'s output schema admits the two advisory fields
  explicitly, since it is `additionalProperties: false`.

### Known gaps

- Workspace-scoped YOLO judges command text with a pattern net, not a parser. Quoting,
  encoding, or an interpreter (`node -e`, a written-then-run script) can hide an escape
  from it; the sandbox boundary, capability leases, and permission rules remain the
  enforcement mechanism.
- Workspace-scoped YOLO also auto-runs in-workspace writes that execute later, such as
  `.git/hooks`, `package.json` scripts, and workspace skill files. They stay inside the
  workspace, so the scope check allows them, but they run the next time a human or a
  tool triggers them.
- Provenance marking is advisory, not enforcement. `file_read`, `file_search`, and
  `search` results carry `untrusted: true` and a notice, but a model that ignores the
  marker can still act on injected text. Approvals remain the backstop.

### Changed

- **Remembered workspace grants restore lazily**: creating or resuming a session now records that a restore is owed instead of re-admitting every remembered grant up front; the leases are admitted when the session first reads them, at most once per session. A session that never touches a workspace no longer writes lease rows, and concurrent first use cannot admit a lease twice. Reconnect re-arms the restore, preserving repair of leases that expired while the connection was away.

### Fixed

- **Restored missing runtime modules and fixed strict typecheck/build failures**.
- **MCP structured-content schema violations**: seven tools could return a shape that failed their own declared (or default) output schema, surfacing as `Structured content does not match the tool's output schema` in strict MCP clients that validate `structuredContent`:
  - `file_list` and `file_search` returned bare arrays instead of an object; now `{ entries: [...] }` and `{ hits: [...] }` respectively, each with a matching output schema.
  - `workspace_list` returned a bare array; now `{ workspaces: [...] }` with a matching output schema.
  - `workspace_current` returned a bare `null` when no workspace was leased; now `{ status: 'none', workspace: null }`.
  - `process_list` returned a bare array even though its output schema already required `{ result: [...] }`; the handler now wraps its result to match.
  - `change_commit` resolved to `undefined` (`ChangeSetService.commit()` had no `return` statement); now returns `{ id, state: 'COMMITTED' }`.
  - `approval_status` / `approval_cancel` returned a bare `null` when the request wasn't found or approvals weren't configured; now return `{ status: 'not_found' }` or throw `CAPABILITY_REQUIRED` accordingly.

## [0.1.3] - 2026-08-28

### Added

- **Host System Capabilities Detection**: non-blocking, bounded probes for host OS details, arch, available shells (`pwsh`, `powershell`, `cmd`, `bash`, `zsh`, `sh`, `wsl`), platform-specific recommended shell resolution, and 11 toolchain categories (Git, Node.js/npm/npx/pnpm/yarn/bun, Python/pip/uv, .NET, Rust/Cargo, Go, JVM/Java/javac/Maven/Gradle, Ruby/RubyGems, PHP/Composer, native C/C++/GCC/Clang/CMake/Make, Docker/Podman); published via MCP `aevra_status` under `execution.system` and displayed in the Admin Dashboard.
- **Local Gateway Protocol & Transport Validation**: added `localProtocol` (`https` | `http`) configuration for the local loopback gateway while maintaining strict loopback HTTPS for internal Admin and MCP listeners; added interactive setup selection in `aevra setup` and a `TransportValidationModal` on the Admin Dashboard with runtime encryption checks and safety warnings.
- **Fast Lane batch tools**: added `file_read_many`, `file_write_many`, and `command_run_many` as the model-facing file-read, file-mutation, and bounded-command interfaces, with ordered per-item results, bounded concurrency, and existing Aevra security controls preserved.
- **React Admin Web UI Polish**: added a dedicated `System Capabilities` section to the Dashboard; `TransportValidationModal`; refactored `use-mcp-activity` hook for live event streams; added accessible `Dropdown` component with full keyboard navigation (arrows, enter, space, escape, focus management) and UI polish styles.

### Changed

- **Simplified MCP discovery surface**: `tools/list` now advertises 40 discoverable tools, hiding singular `file_read`, `file_create`, `file_write`, `file_patch`, and `command_run` primitives while retaining them internally for secure delegation and backward-compatible direct calls.
- **Batch write contract**: `file_write_many` publishes operation-discriminated create/replace/patch schemas, rejects duplicate paths prior to dispatch, and rejects fields that do not belong to the selected operation instead of silently discarding them.
- **Startup status output & safety warnings**: `aevra start` renders Core readiness, the MCP endpoint, and Dashboard URL in an aligned terminal table; warns clearly when running with a local HTTP loopback gateway. With `--ui`, the browser-opening line follows the table, and `Press Ctrl+C to stop Aevra.` is always the final startup line.
- **Documentation**: synchronized all engineering specs (01–09, README), user manual guides, and root README with Aevra v0.1.3, the 40-tool discoverable surface, Fast Lane batch operations, system capability detection, and transport validation.

### Fixed

- **Quality gate hangs**: MCP session integration cleanup now closes server/database resources even when assertions fail; Node test and coverage subprocesses have bounded timeouts and coverage batches identify suspect files instead of hanging CI indefinitely.
- **Fast Lane registry coverage**: updated stale registry expectations to distinguish stable internal singular primitives from the public batch tool surface.
- **Shell resolution**: command and shell tools now respect host capability probes and auto-resolve to the platform's recommended shell.

## [0.1.2] - 2026-08-26

### Added

- **OAuth connection continuity**: durable OAuth connection identity, configurable reconnect grace, rotating refresh-token families with replay revocation, remembered multi-workspace grants, persisted connection-level YOLO, and explicit session disconnect versus connection revocation semantics.
- **Durable operation inspection**: added read-only `operation_get` and `operation_list` MCP tools so reconnecting OAuth clients can inspect connection-owned mutation outcomes without automatically replaying writes, commits, deletes, or commands.
- **Independent Admin exposure**: added a separate `adminPublicUrl`, explicit exact-HTTPS `trustedAdminOrigins`, environment bootstrap via `AEVRA_ADMIN_PUBLIC_URL` / `AEVRA_TRUSTED_ADMIN_ORIGINS`, and an authenticated Admin reachability/trust probe.
- **Stable managed ngrok domains**: managed ngrok can request a configured stable HTTPS URL and fails closed if the discovered forwarding origin does not match.
- **Keep Awake policy**: added `off`, `remote-connections`, `managed-processes`, and `always` modes with platform-specific idle-sleep inhibition that leaves screen locking/display timeout unchanged.

### Changed

- **Settings UX**: compacted Keep Awake and Execution controls; moved advanced execution values behind a disclosure; moved command overrides, network rules, environment profile creation, and secret storage into focused modal workflows.
- **Remote Access UX**: separated MCP/OAuth and Administration Web UI configuration, made the Admin public URL the primary origin, added compact trusted-origin management, and kept Admin probe results next to the tested URL.
- **Runtime Overview**: descriptive Sleep inhibition state now uses compact status typography instead of the large numeric metric treatment.
- **Documentation**: synchronized the engineering specs with MCP protocol `2025-06-18`, the 42-tool surface, schema migrations through v10, connection continuity, independent Admin exposure, stable ngrok, keep-awake behavior, and current configuration keys.

### Fixed

- **Lease continuity**: general activity now refreshes every active workspace lease in a multi-workspace session while expired session-only leases remain expired.
- **Remembered workspace recovery**: authenticated OAuth reconnect/restart restores missing remembered workspace leases without reviving one-shot/session-only authority.
- **Admin origin security**: the MCP public URL is no longer implicitly trusted for Admin mutations, and forwarded host/proto headers cannot expand the trusted Admin origin set.

## [0.1.1] - 2026-08-25

### Added

- **CLI Version & Help Aliases**: Added `aevra -v`, `aevra --version`, and `aevra version` commands for quick version inspection without requiring configuration or credentials, and supported `aevra -h` as an alias for `aevra --help`.
- **Web UI Update Notification**: Automatically checks npm registry for newer versions; when outdated, displays a click-to-copy `npm i -g @the-long-ride/aevra@latest` command in the top bar.
- **Provider Badges in README**: Added badges for Gemini, Langdock, and Manus AI, and updated ChatGPT badge with the official OpenAI logo.

### Fixed

- **Web Dashboard Packaging**: Include `dist/apps/web` in `package.json` `files` array to ensure all React UI assets, icons, and user manual pages are included in published npm packages.
- **Static Web Path Resolution**: Anchor `staticDir` to module location via `import.meta.url` instead of caller working directory (`process.cwd()`), eliminating 404 Not Found errors when starting Aevra globally or from arbitrary directories.
- **CI Container Integration Tests**: Pre-pull Alpine container image and install Podman in CI quality gate to prevent timeouts on cold runners.

## [0.1.0] - 2026-08-25

Initial release of Aevra — a workspace-scoped local MCP execution gateway for AI web interfaces with policy, recovery, and audit controls.

### Added

- **MCP 2.0 Protocol & Native Capabilities**
  - Standard MCP protocol tools, dynamic resources (`aevra://skill/<source>/<name>`), prompts (`aevra-instructions`), and completions.
  - Closed input schemas and `outputSchema` metadata for stable public tools.
  - Native workspace search tool (`workspace_search`) with regex, multiline, case sensitivity, file glob filters, and bounded result streaming.
  - Sandboxed MCP lifecycle hooks (`lifecycle_hook_register`, `lifecycle_hook_list`, `lifecycle_hook_unregister`, `lifecycle_hook_execute`) with isolated execution environments and timeout bounds.
  - Dedicated granular capability permissions (`skills.read`, `skills.write`, `instructions.read`, `instructions.write`).
  - Path-contained `skill_write` and `instructions_write` tools preventing general filesystem write authority.
  - Multi-workspace MCP leasing and connection-scoped workspace grants.
  - Chunked `file_read` via `{offset, length}` with per-chunk hashes and `totalLength`.

- **Provider-Neutral Exposure & Gateways**
  - Unified HTTPS Public Gateway fronting internal loopback Admin and MCP listeners.
  - Multi-provider exposure support: Local loopback, Direct HTTPS with automatic TLS certificate generation, Cloudflare Access, managed ngrok tunnels, and custom external tunnels (Caddy, Tailscale Funnel, FRP, reverse SSH).
  - Reachability watchdog probe with 60-second health checks for active exposure channels.
  - OAuth 2.0 / PKCE authentication for ChatGPT and web AI clients with path-aware metadata discovery, CORS preflight on `/mcp`, JSON token support, and pairing code protection.
  - 128-bit cryptographically secure connector admission tokens (SHA-256 at rest, constant-time verification, instant revocation).
  - Token rotation (`POST /api/connectors/:id/rotate`) with a 5-minute grace window.
  - Per-IP token-bucket rate limiting on connector admission with failed-attempt counters.

- **Security & Data Isolation**
  - Multi-tier capability profiles (Minimal, Read-Only, Safe Dev, Power Dev, Full Access, Custom) with granular permission rules.
  - Central `SecurityGuard` boundary enforcing `SECRET` denial and `SENSITIVE` masking/redaction with one-time mutation approval.
  - Worker-side defense-in-depth blocking symlink and hard-link secret file bypasses.
  - Ranged file reads with multibyte UTF-8 preservation using JavaScript string offset semantics.
  - `policy.critical.alwaysConfirm` configuration forcing explicit local confirmation for critical operations.
  - Structured sanitizer using null-prototype records to neutralize `__proto__` injection.
  - Immutable hash-chained audit logging for all lifecycle and security-sensitive events.

- **Durable Process Management & Recovery**
  - Out-of-process Worker dispatcher over secure OS-local IPC (POSIX sockets / Windows named pipes).
  - Isolated host, managed-process, Docker, and Podman runtime execution environments.
  - Durable managed process lifecycle: `process_start`, `process_wait`, `process_status`, `process_logs`, and `process_stop`.
  - Named managed processes with SQLite persistence and runtime projections.
  - Detached `keep-running` process completion sidecars allowing background execution observation across helper exits.
  - Journaled change sets with rollback and recovery mechanisms.

- **React Admin Web UI**
  - Single-page Admin dashboard with clean dark theme (`admin.css`, `auth.css`) and responsive layout.
  - Mandatory `AEVRA_USERNAME` / `AEVRA_PASSWORD` authentication gate with session revocation on server restart.
  - Unified Connections management combining OAuth sessions and static Bearer connectors.
  - Interactive Runtime Overview with dedicated management modals for Managed Processes, Open Changes, Tool Activity, and Connectors.
  - Real-time MCP activity monitoring with newest-first stream, search, filtering (client, workspace, type, status), pagination, and sanitized input/output payload details.
  - Multi-workspace management with debounced server-side directory browsing and native server picker.
  - Built-in interactive User Guide with sticky navigation and tunnel configurations.
  - Shared UI components: compact 32px controls, custom Dropdown, DataTable with browser-local datetime formatting, Switch, and accessible Dialogs.

- **CLI & Tooling**
  - `aevra` CLI with commands for server lifecycle (`start`), connectors (`connectors list|create|revoke`), status (`status [--json]`), backup/restore (`backup verify|restore`), and shell completion (`completion bash|zsh|powershell`).
  - Friendly CLI error handling when credentials are unset without dumping stack traces.
  - Comprehensive quality gates and test suites across unit, contract, integration, security, React, and Playwright UI parity.
