# Changelog

## [1.3.2] - Unreleased

### Added

- File transfer tools. `files_download` (agent sends files to this device) and `files_upload` (agent pulls files from this device) move one to 64 files of any type per call. `files_download` entries carry inline base64 or a public `url` with optional `headers`; URL bodies stream to a temp file in the target folder and are moved into place, `overwrite` defaults to false, and a declared `mimeType` that disagrees with the sniffed content is reported per entry (`mimeMismatch`). `files_upload` returns small results inline (`delivery: auto` stays inline up to 4 MB, then switches to links; `inline` forces inline up to the inline limit; `link` always mints links). Each batch asks for one HIGH once-scoped `files:transfer` approval listing every entry (host names and the count of supplied headers, never header values, URL queries or bytes); under YOLO risk `do-whatever` no approval is asked. Secret and protected paths are refused per entry in every mode.
- One-time download links for `files_upload`: `GET /files/<secret>` on the public MCP origin. The secret is 32 random bytes kept only as a hash, the link lives 5 minutes in memory, serves exactly one successful download (an aborted transfer may retry until it expires), is tied to the connection that minted it and dies when that connection is revoked or disconnects. Unknown, expired, used and revoked links all answer the same 404. A bearer token is optional; when sent it must belong to the same connection. Every fetch is audited as `files.link.fetch` with the link id, never the secret. Links need a configured public URL (`PUBLIC_URL_REQUIRED` otherwise).
- Transfer limits in Settings (`files.transfer`, `GET/PATCH /api/files/transfer-settings`): per file 200 MB, per batch 500 MB and inline 50 MB by default, editable in MB (1 to 10240; inline at most 256) and clamped so inline <= file <= batch.
- Settings > Tools: a global on/off switch per tool, including tools of linked MCP servers, with group switches and search (`GET/PUT /api/tool-switches`, stored as `tools.disabled`, audited as `tools.switches.update`). The core group (`workspace_*`, `operation_*`, `approval_*`, `aevra_status`, `control_access_status`) is locked on. A disabled tool is removed from `tools/list` and refused when called by name, including through a hook rename. Clients see a change on the next `tools/list`; Aevra does not push `tools/list_changed`.
- New error codes: `FILE_EXISTS`, `FILE_CHANGED`, `URL_NOT_PUBLIC`, `URL_SCHEME`, `TOO_MANY_REDIRECTS`, `SIZE_LIMIT`, `URL_TIMEOUT`, `INLINE_TOO_LARGE`, `BATCH_LIMIT`, `PUBLIC_URL_REQUIRED`.
- Connector notes: each connection's detail modal has a Notes tab where the user leaves notes (text plus up to 4 png/jpeg/gif/webp images, 2 MiB each) for the AI agent using that connector. Blank titles become `note-N`. Each note has Visible to AI, AI can delete and Read on connect switches; deletes are permanent. New always-listed MCP tools `notes_list`, `notes_read` (images as MCP image content) and `notes_delete` (only when the user allowed it). Notes are read only when the user mentions them, except visible notes with Read on connect on: when the connector has any, the connect handshake tells the agent to read those notes. There is no connector-wide switch. Admin API under `/api/connector-notes/:actor`.
- Requests drawer: Clear history removes finished approvals (including timed-out requests) after confirmation; pending and approved-but-not-run requests and the audit log are kept (`DELETE /api/approvals/history`). The history filters use a compact one-row layout.
- First-launch welcome modal: a short friendly greeting that checks whether `cloudflared` and `ngrok` are installed (`GET /api/system/tunnel-tools`; Cloudflare Tunnel is recommended when both are ready, with download links when neither is), points new users to the Guide tab's Copy prompt button, and on any close opens Settings with the remote access section highlighted for 5 seconds. It shows once; the seen flag is the existing server-side onboarding flag, so users who completed onboarding are not shown it.
- Multi-workspace grants for connectors: connectors can now be granted multiple workspaces simultaneously via a searchable dropdown multi-select in the Connector modal (or default to none granted). Each granted workspace configures an admission profile (`full`, `read-only`, `custom`), admission mode (`standard`, `isolated`), and per-workspace external mount capability controls (`read-only`, `read-write`, `blocked`).
- Dual configuration snippets: connector creation and detail modals display both Local URL and Tunnel URL JSON configuration blocks side-by-side on desktop (and stacked on mobile/tablet) with dedicated top-right icon-only copy buttons.
- Searchable actor dropdown list: connector creation and detail feature a searchable actor dropdown with profile and admission data consistent with connector permissions.
- Global confirmation dialog keyboard shortcuts: Primary action triggers on `Enter` keypress and Cancel triggers on `Esc` keypress across all modal and confirmation dialogs in the Web UI.
- Independent toast notification lifecycle: toasts feature isolated entrance and exit CSS animations (`toast-in` and `toast-out`) with pointer event management, ensuring toasts persist and dismiss smoothly across tab navigation and modal state changes.

### Changed

- YOLO policy has two independent settings, risk and scope (`policy.yolo` is now `{mode, risk}`; `PATCH /api/policy/yolo` merges and audits as `policy.yolo.update`). Risk `prevent-high-risk` (default) still confirms CRITICAL work; `do-whatever` runs it without confirmation only when scope is `unrestricted`. With scope `workspace`, commands outside the workspace or of unknown scope still ask. Non-command tools such as file transfer skip approval under `do-whatever` in either scope. Scope `workspace` keeps work inside the workspace; `unrestricted` now only lifts the scope checks, so remembered denies, network deny, script trust, network approval and unsupported syntax still apply to commands outside the workspace or of unknown scope. Under `do-whatever` with scope `unrestricted` they are skipped. A command conclusively inside the workspace is allowed under any YOLO setting before those checks. Secret-path and DLP denial apply in every combination.
- Dashboard: the Onboarding section is removed; the welcome modal replaces it.
- Modals and dialogs now isolate the page: while one is open the page behind does not scroll or take clicks and focus, scrolling stays inside the modal, and a dialog opened from a modal keeps the modal inert until it closes (toasts stay visible).
- Connection detail modal: the Notes tab label shows the note count, for example `Notes (11)`, when the connector has notes.
- Note editor: the Visible to AI, AI can delete and Read on connect switches sit on the same row as the title.
- Connection detail modal: Details and Notes tabs, titled sections, and switches instead of checkboxes for the tool surface.
- Modern `server/discover` results are now always `cacheScope: 'private'`. Token usage no longer counts base64 image data in tool results.
- Server `_meta` (name, version, description, icon) is now sent only on `initialize`, `server/discover`, `tools/list` and the results of base tools (`aevra_status`, `workspace_*`); the description is rewritten. Other responses carry no server `_meta`.
- The MCP request body limit is 1 MB except for `tools/call` of `files_download`, which may carry the inline limit plus base64 overhead (OAuth routes stay at 1 MB). The advertised `tools/list` size budget is 56,000 characters.
- Settings: the Local AI agents section's Add connection button is now Connect; the connect dialog uses switches, lets you pick several workspaces, and shows a compact two-column preview.
- Settings page layout: swapped order of YOLO policy and Execution sections (YOLO policy placed beneath Keep Awake); eliminated empty void space below Execution card by wrapping Execution and File Transfer into a balanced column stack opposite Tools.
- Settings > Tools: tool switch categories start collapsed by default (`defaultOpen: false`) with automatic expansion during search filtering, and scrollable container height reduced to a compact 280px.
- Settings > Browser Control: redesigned Browser origin policy host lists into 2-column responsive cards with `danger` ("Refuse") and `warning` ("Ask every time") tags, monospace input typography, and pixel-perfect header baseline alignment. Segmented `SwapControl` replaces radio buttons for loopback classification.
- Settings > Execution & File Transfer: "Advanced execution settings" converted to an outline secondary button; "Save execution" relocated to the top-right card header; "Save transfer limits" relocated into the desktop 2-column control grid alongside "Max inline size (MB)".
- About page layout: "Support & Community" card relocated to the second row with `grid-column: span 2` across the full grid width beneath Aevra and Links & Resources.
- Mobile viewport polish: New Connector button occupies full width on mobile viewports; reduced modal header heights; standardized red square `[x]` removal button pattern; replaced bulky "Ready" badges with color-coded status indicators.

### Security

- `files_download` URL fetches reach public addresses only: loopback, private, link-local, CGNAT, IPv6 equivalents and cloud metadata hosts are refused after DNS resolution and on every redirect (at most 5, http(s) only), the vetted address is pinned for the connection, and the size limit is enforced while streaming.
- Agent-supplied headers, inline bytes and URL queries live only in the volatile approval slot and the in-flight call; tickets, audit, the activity log, hook payloads and results never hold them.

## [1.3.1] - 2026-10-19

### Added

- Custom startup listeners: `aevra start --ui --basePort=50000` moves gateway, UI/admin and pairing, MCP, and extension WebSocket to `50000`–`50003`. Individual `--gateway-port/--gp`, `--ui-port/--up`, `--mcp-port/--mp`, and `--ws-port/--wp` flags change any selected listeners. Both `--flag=value` and `--flag value` work; mixed modes, duplicate aliases, invalid values, overflowing blocks, and colliding listeners are rejected before binding.
- User-service install/start/restart accept the same options and retain the selected startup arguments. Foreground overrides remain invocation-only; later UI/status/agent-management commands discover the running instance's actual listener addresses.
- Document the implemented custom-port contract, service retention rules, extension pairing addresses, and versioned release metadata for the core, dashboard, and owned browser extension.

### Fixed

- Pass the configured WebSocket port into the execution worker, pairing replies, and origin protection. A failed WebSocket bind now fails startup and releases the other listeners instead of announcing an unusable port block.

## [1.3.0] - 2026-10-17

### Added - Local AI agents and browser packaging

- Safety for agent changes and purges: agent install/uninstall keeps a write-ahead journal in `<folder>/<product>.pending.json` and a cross-process lock shared with Aevra Browser, so an interrupted run is undone (or finished, when its manifest already landed) by the next agent command; `agent status` reports a pending journal. The journal may hold the previous contents of an agent config, which can include a token, until the operation completes; a journal naming files outside agent configs, the manifest, the skill or credential files is refused. `uninstall --purge` removes only what the product marked as its own (`.aevra-state-owner.json`): a custom `AEVRA_STATE_DIR` that was not empty when first marked keeps its pre-existing entries, and a folder moved to a new path keeps its ownership. An extension the user edited is kept, not fatal. Uninstall dry runs list what a purge would remove and keep.

- Add shared port-selected browser extension packaging, local stdio MCP bridging, managed Codex/Claude Code/OpenCode/Antigravity registration, canonical skill links and ownership-aware removal. Add standalone Browser settings UI/CLI and durable per-agent HTTP credentials.

- Add local AI agent management: `aevra agent list|status`; `aevra agent install` with no target acts on the detected agents after a `Proceed? [y/N]` confirmation (`--yes` skips it, a run without a terminal and without `--yes` prints the list and exits 1, `install all` with nothing detected exits 1); `--scope user|workspace`; `--workspace <name>` (implies workspace scope, resolved through registered Aevra workspaces); the `claude` alias; and `--json` (one JSON document on stdout; credential file paths and hashes are never printed). Workspace scope is stdio only, installs no skill and creates no skill links; the entry goes to `<root>/.codex/config.toml` (Codex, trusted projects only), `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`) under `projects[<root>]` (Claude Code, nothing written into the project), `<root>/opencode.json` or an existing `.jsonc` (OpenCode) or `<root>/.agents/mcp_config.json` (Antigravity). The install refuses with `AGENT_PROJECT_FILE_TRACKED` when git tracks the target file and otherwise adds it to the repository `info/exclude`. It also refuses a symbolic link or junction on the way to the file inside the project (`AGENT_PATH_CONFLICT`), a workspace folder that is the home folder or a filesystem root, and a project file that is the agent's global file (`AGENT_OPTIONS_INVALID`); git runs only from an absolute `PATH` entry outside the project. Detection uses `PATH` names or config homes and never spawns a process. Settings now shows a connections table with Last used and an Add connection dialog (detect agents, global or one workspace, dry-run preview, per-agent results).

- Breaking: `aevra agent serve --credential-file <file>` replaces `aevra mcp serve --stdio` with no alias. Configurations written by earlier local builds are refreshed by running `aevra agent install <agent>` again: an existing stdio connection whose entry differs is rewritten in place and keeps its credential.

- Change: root `aevra uninstall` now prints a human summary instead of raw JSON (it has no `--json`) and runs product cleanup only after agent removal succeeded: a managed entry or skill modified since install refuses the uninstall, and cleanup and `--purge` are then skipped. A hand-written `aevra` entry of an agent Aevra never registered no longer blocks uninstall. `aevra agent uninstall all` without `--scope` removes every connection, including orphaned workspace ones.

- Change: agent uninstall scopes are explicit. `POST /api/agents` forwards `scope` as sent; `scope: 'user'` removes global connections only, also for `target: 'all'`; new `scope: 'all'` (uninstall only) removes every connection; a single-call `target: 'all'` uninstall without a scope means `all`, runs agent by agent and reports per-agent results instead of failing as a whole. `aevra agent uninstall all` and `aevra uninstall` send `scope: 'all'` (an older core refuses it as an unknown scope: restart `aevra start`).

- Add `aevra agent uninstall --id <id>` and `credentialId` on `POST /api/agents` (uninstall only): removes exactly one connection by its connection id, also when its workspace folder was deleted or is not a registered Aevra workspace; `agent list` prints the id of such connections and Settings now removes them with Remove (Update stays disabled).

- Fix: `aevra agent install <agent>` again after an MCP port or TLS CA change rewrites the stdio credential file's endpoint and CA file (same credential) and an HTTP entry's endpoint with the stored credential, instead of reporting `no change`. A workspace install in a git repository whose git cannot be found outside the project now notes that tracking was not checked; device-path and 8.3 short-name `PATH` entries into the project are refused as git candidates. Claude project keys are matched case-insensitively only on Windows and macOS. `uninstall all` with only workspace connections no longer touches the user skill.

- Change: admin audit records of agent dry runs carry `dryRun: true`; `aevra agent list` and `install` against an older core without `GET /api/agents/detect` print the version hint and exit 1.

- Enlarge Web UI token summary values, remove card detail rows, and show the saved percentage inline with the saved count in daily and all-time statistics.

- Fix macOS native build/test setup: explicitly select installed Xcode 26+ and verify Metal SDK declarations, persist its SDK path, and link Rust consumers with the system Swift runtime search path. Apply the same prerequisite to Desktop release builds and the root helper matrix.

- Repair desktop security regression fixture types so the full Node coverage compiler checks authorized read arguments, nullable capture results and the current input gate direction without casts that hide interface drift.

- Enforce Rust format and strict Clippy in root desktop-helper CI, and explicitly select Node.js 24 in native/helper and changed-area jobs. Limit Markdown text-file formatting to `llm.txt` so CMake and generated text caches retain their native syntax.

- Fix GNOME 46 keyboard input refusal by distinguishing the stage fallback from Shell-owned focus; keep modal, overview and Shell actor guards, with a cross-version policy regression.
- Fix strict Rust 1.99 Clippy failures across desktop platforms using fixed-size pixel chunks, platform-specific compilation and simpler native bindings. Regenerate the shared helper overlay without weakening CI checks.

- Standardize current runtime/build CI on Node.js 24 and GitHub-maintained Actions `@v6`; add local `.node-version` files and keep independently versioned Rust cache support.

### Desktop authorization and architecture

- Bind window capture/describe to the authorized native identity and recheck read attribution/current policy before publishing; refuse native-ID reuse and mid-read allowlist revocation.
- Invalidate connection generations on disconnect/reconnect; reject cancelled connect completions and prevent older reads from returning data or reinstalling foreground refs after session changes.
- Refuse GNOME Shell keyboard/modal grabs, correct decorated frame/buffer capture and click geometry, preserve KDE fractional wheel coordinates, and invalidate stale native mappings/refs on explicit reconnect.
- Extract the canonical native helper library and shared prepared-action executor, removing mirrored standalone module/dependency wiring and broad lint suppression. Add behavioral host/native regressions and library-boundary checks.

- Add the KDE KWin 6.6 native plugin, explicit executable-path grants with persisted nonce consumption, pinned kernel/compositor identity, isolated window-item capture and guarded virtual input. Include reproducible source packaging and required KDE CI.
- Add real held-button disconnect regression; flush KWin pointer teardown and avoid forced GNOME device disposal while queued release events still reference the devices.

### Desktop capture and input

- Implement native GNOME Wayland window capture and foreground input in the shared helper, with an explicit-install GNOME Shell companion, approved helper path, visible pause control, lock/peer revocation and compositor-native window/occlusion checks. Preserve independent AT-SPI semantic access.
- Add required private GNOME/GTK target-and-sentinel acceptance for both hosts: actual button/wheel events, Unicode input, Ctrl+A replacement, protected fields, focus changes, isolated window pixels and paused-access refusal. Package the companion with Linux helper/desktop artifacts.
- Document GNOME and KDE setup, the canonical helper library and shared input executor, authorized read publication and reconnect recovery. Keep runtime evidence separate from configured CI and remaining platform acceptance.

- Bind every foreground request to the process/window/executable/host identity authorized by the worker or standalone host; refuse changed targets before new native effects and preserve held-key cleanup.
- Prepare portable input once, refresh only bound process/field paths per effect, and stop after a 7.5-second native input budget with explicit partial-outcome errors. Add private X11 focus-switch and 280-character Unicode regressions.
- Resolve macOS foreground windows through the active AX window rather than the active PID; cover two editors and a non-key palette in shared tests and the opt-in native fixture.
- Reconcile canonical overlay reverts and file removals with drift protection and clean-apply regression tests, including empty files and missing final newlines.

- Add macOS 13+ ScreenCaptureKit isolated-window capture and CoreGraphics text/key/mouse input, and Linux X11 Composite capture with XTest input. macOS native execution remains pending.
- Preserve process-instance attribution, unique native window binding, fresh ref validation, protected-field checks, pointer occlusion/focus guards and held-key cleanup. Validate complete chords and inject Unicode through the text transport.
- Add shared guard regressions, real private-X11 pixel/input tests, and an accessible GTK backend fixture proving exact Unicode text, Ctrl+A replacement, attributed capture and protected-field refusal. Include an explicit macOS fixture run.
- Carry the same canonical helper into standalone desktop using a reproducible, hash-checked overlay, including clean CI/release preparation, independent capture/input readiness and permission recovery guidance.
- Support Ubuntu X11 plus native GNOME Wayland and KDE KWin 6.6 companions. GNOME/KDE private-compositor acceptance runs in both consumers; native macOS, physical-GPU/OpenGL capture, actual lock-screen transitions and production grant workflows remain separate acceptance gates. Other Wayland compositors remain roadmap work.
- Fix: agent uninstall now revokes a credential only after every configuration edit and the connection record are saved; a failed revoke fails with `AGENT_REVOKE_INCOMPLETE` naming the credential ids still valid and keeps the saved files, and git exclude or file cleanup failures after the save are notes that never undo it. Install checks its plan only inside the lock and removes empty lock folders it created. Engine results carry an optional `removed` list.
- Change: Settings Remove asks for confirmation. A connection whose credential was deleted shows `Credential missing` (CLI `missing`, state `incomplete`) instead of `Never used`; a response without `results` no longer crashes the page.
- Fix: the stdio bridge no longer leaves unhandled rejections on a broken stdout, and the stdio-http size check is linear.

### Added - Management and usage documentation

- Pressing Enter in an open dialog now activates its primary button (the last enabled one when several exist). Enter in a form field still submits natively, never acts from a focused button, link, select or textarea, and is ignored while composing text, on key repeat or with a modifier. Approval request dialogs opt out with `data-enter-default="off"` so a stray key press can never grant access.
- Expose MCP server status, catalog details, tool documentation and parameter examples in searchable management views, while keeping upstream descriptions untrusted.
- Add all-time token statistics beside the chart range controls, with totals, savings, calls, failures and tool/connector breakdowns independent of the selected chart range.

### Documentation

- Synchronize current specs, guides and runtime version surfaces with 1.3.0; preserve previous release history.
- Record the separate 1.0.0 browser/desktop release targets. Their pinned Aevra 1.2.1 source snapshots are unchanged.
- Keep full macOS/Linux pixel capture and raw input in a proposed cross-repository design; this release does not implement that parity.

### Security - Execution and remote control

- Harden Git execution against repository hooks, filters, external commands and unsafe read flags; exclude protected content from diffs/history and reject SECRET commit selections, including hard-link aliases.
- Bind one-time approvals to their frozen invocation and remembered command rules to explicit environment values. Refuse loader overrides, ambiguous Windows paths and unresolved executables; recheck file mutation containment immediately before I/O. Windows credentials now use the native credential API with values sent over stdin.
- Bind OAuth actors to redirect origins, migrate unambiguous authority, quarantine legacy namespace collisions, bound registration/authorization queues and isolate valid connector traffic from invalid path attempts.
- Guard malformed HTTP input and Host headers, minimize public health responses, deny framing, preserve local-only pairing behind the gateway, and isolate a previously authenticated device's login throttle.
- Recheck browser document/origin policy during reads and action batches, and restrict CDP to the operator's loopback port. Desktop reads honor app policies and exact-path grants; full-screen capture requires HIGH approval.
- Forward only acknowledged upstream entries, bind Acknowledge to the catalog shown, fingerprint prompt/resource metadata, mark descriptions untrusted, and isolate stdio child environments. Hide reserved, unenforced mount sensitivity policy IDs from the workspace UI.

### Added - MCP servers

- **Enable and disable a server:** A registered MCP server can be turned off without removing it, from the switch in **Settings → MCP servers** or with `aevra mcp disable <id>` and `aevra mcp enable <id>`. A disabled server is hidden from tool, prompt and resource lists, its connection is closed, and calls, tests and refreshes are refused with `MCP_UPSTREAM_DISABLED`. Its configuration and credentials are kept, and re-enabling reconnects on first use. A server in **Needs review** still needs **Acknowledge**.
- **Enabled column and filter:** `aevra mcp list` shows an Enabled column (`yes`/`no`). The Web UI table gains a separate **Enabled** filter, a **Disabled** badge, and a dimmed row for disabled servers.
- **Admin routes and audit:** `POST /api/mcp/upstreams/{id}/enable` and `POST /api/mcp/upstreams/{id}/disable` return the updated record. Each real change is audited as `mcp.upstream.enable` or `mcp.upstream.disable`; repeating a toggle that is already in effect writes nothing.
- **Catalog changes are visible on a normal list load:** Core reconciles upstream catalogs before `GET /api/mcp/upstreams` (single-flight, time-bounded, no retry), so a server whose catalog changed shows **Needs review** without a manual test or refresh.
- **Review icon, dialog, notice and auto refresh (Web UI):** A leftmost warning icon in **Settings > MCP servers** opens a review dialog showing the added, removed and changed entries. Accept lives in the dialog and sends the fingerprint the dialog showed. A notice line counts pending servers, and the table refreshes automatically.
- **`aevra mcp list` marks pending servers:** A `!` column marks servers that need review, followed by one next-step hint line per pending server.
- **`aevra mcp review <id>` and `aevra mcp accept <id> --yes`:** `review` prints the pending catalog diff and the accept command; `accept` shows the same diff and, with `--yes`, acknowledges exactly the catalog shown. A catalog that changed again is refused with `MCP_UPSTREAM_CATALOG_CHANGED` and a prompt to review again.
- **Audited acknowledge:** A successful acknowledge is audited as `mcp.upstream.acknowledge`; a failed one writes nothing.
- **Known limit:** Aevra emits no `list_changed` notification for this change, so a connected client sees it on its next list request.

### Fixed - MCP servers

- **Editing a disabled server re-enabled it:** Saving an edit now keeps the server's enabled state, and the edit of a disabled server is stored without connecting to it.
- **A failed edit reconnected a disabled server:** If an edit that enabled a server failed its handshake, Aevra restored the old connection even though the server stayed disabled. It now leaves a disabled server stopped.
- **Disabling waited for in-flight work:** Disabling a server no longer waits for a running call or refresh to finish. Any connection that work reopens is closed when it ends.
- **Hidden disconnect failures:** If Aevra cannot close a disabled server's connection, the toggle and edit responses now include a `warning`, the audit result is `warning`, and the CLI prints it.
- **Edits to a disabled server were served unverified:** A connection edit made while disabled marks the server **Degraded**, and enabling it reconnects and checks the catalog before it is served.
- **Wrong status codes:** `MCP_UPSTREAM_DISABLED` now returns 409 instead of 400, and adding a server with `enabled: false` is refused with `UPSTREAM_ENABLED_INVALID` instead of being silently enabled.
- **Edit audit raced with toggles:** The edit route now decides whether `enabled` changed under the same lock as the edit, so a concurrent toggle cannot produce a missing or duplicate audit record.

### Added - Permissions & Approvals

- **`APPROVAL_SCOPE_MISMATCH` protocol error:** An MCP session that tries to resume a workspace-access approval granted `once` for a different session on the same OAuth connection receives `APPROVAL_SCOPE_MISMATCH` instead of an empty result. This stops rotating clients from looping on an approval they can never resume.
- **Connection-wide workspace access:** OAuth workspace-access requests can now be approved with "Allow this connection", which grants the workspace to every session of that connection. Connectors and local sessions remain one-time only.
- **Operator guidance for rotating clients:** When an OAuth connection opens three or more sessions within 15 minutes, a pending workspace-access request shows a non-blocking hint recommending "Allow this connection".

### Fixed - Permissions & Approvals

- **Scope-correct ticket reuse on rotating sessions:** A new session no longer reuses a workspace-access approval it cannot resume (one granted `once` for another session, or for different arguments). One-time capability approvals still resume from any session on the same OAuth connection.

## [1.2.1] - 2026-10-12

### Fixed - Web UI

- **Modal footer hidden when zoomed in:** Create/Edit modals are now a flex column with a fixed head and foot and a scrolling body, so the footer actions stay reachable at high zoom.
- **Secret reference names missing from the table:** The name resolves from `ref`, `id`, `keyRef`, or `key`, so newly created references show their name.

### Added - Web UI

- **Edit secret reference:** Each reference has an **Edit** button that opens the modal with the name read-only so its value can be replaced.

### Changed - Web UI

- **Toasts instead of inline hints:** Action results and validation errors across Settings, Data, Permissions, Remote access, workspace and connector modals, and the approval modal now use the shared toast through a new `useToast` hook over the existing `.toast-stack` markup. Login panel errors stay inline. Dead inline-hint CSS was removed.

### Security - Admin login lockout

- **Escalating lockout on failed Admin logins:** Failures are counted per client address and per (address, username) in a 15 minute sliding window. Five failures lock that pair and twenty lock the whole address, for 1 minute, doubling on each further lockout up to 1 hour. The level decays after a quiet window, the lock is temporary so a known username cannot be locked out permanently, and a successful login clears the pair counter. Locked requests return `429` with `Retry-After` and the same body for every username; attempts still in flight count toward the threshold so parallel guesses cannot slip past the check.
- **Real client address behind the gateway:** The Admin plane now keys the throttle on the forwarded client address (`cf-connecting-ip`, `true-client-ip`, `x-real-ip`) only when the request came through the trusted gateway and the operator enabled `trustedProxyClientIp`, and only if the value parses as an IP. Otherwise it keeps using the peer address.
- **Audit and notification:** Every lockout is written to the audit log as a `security` event (`admin.login.lockout`) and raises a desktop notification, at most one a minute.
- **Login panel countdown:** A `429` shows an inline countdown from `Retry-After` and disables sign-in until it ends.

## [1.2.0] - 2026-10-08

### Added - Token Usage Accounting & Storage

- **Lightweight token estimator (`heuristic-v1`):** Protocol-level estimator (`packages/protocol/src/token-estimate.ts`) calculates non-negative integer token estimates across request arguments, responses, and saved characters: ASCII `ceil(length / 4)`, CJK/Hangul/kana/full-width/emoji 1.0, and other Unicode characters 0.5.
- **SQLite token storage (migration 25):** Added `token_usage` table (`WITHOUT ROWID`, PK `(granularity, bucket, connector, tool)`) in migration `025_token_usage`. Tracks `calls`, `errors`, `input_tokens`, `output_tokens`, `saved_tokens`, and `duration_ms` without storing command arguments, outputs, or file paths.
- **In-memory accumulator & automated roll-up:** `UsageMeter` accumulates live request counters in memory, flushing to SQLite every 30 seconds and on runtime shutdown. Hourly records (UTC `YYYY-MM-DDTHH`) older than 7 days are automatically rolled into host-local day records (`YYYY-MM-DD`) and pruned, keeping storage under ~1.5 MB/year.
- **Admin Usage API:** New endpoint `GET /api/usage/tokens?range=24h|7d|30d|90d|all` returns zero-filled timeseries, today totals, range totals, top 10 tools by output tokens, and per-connector breakdowns. Invalid ranges return 400 `INVALID_RANGE`.
- **Runtime Overview analytics:** Added `TokenUsageStats` cards in the dashboard overview grid (Tokens out today, Tokens in today, Saved today with percentage, Avg tokens per call, Top tool today) seamlessly unified into a 7×2 flow layout with identical 1-column spans, 10px uppercase labels, 16px values, and subtle 11px context notes. Placed interactive SVG history chart legend and heuristic note on a single row with space-between alignment.

### Added - Connector Tool Surfaces & Result Formats

- **Per-connector tool groups:** Configure enabled tool surfaces per client in setting `mcp.connectorProfiles`: `files`, `commands`, `git`, `changes`, `skills`, `browser`, `desktop`, `control`, and `upstream`. The `core` group (`aevra_status`, `control_access_status`, `workspace_*`, `operation_*`, `approval_*`) is always on.
- **Fail-closed group enforcement:** Calling a tool in a disabled group immediately returns error code `TOOL_GROUP_DISABLED` naming the group and Settings path.
- **Per-connector result format:** Choose `both` (dual text + structuredContent, default), `text` (text only), or `structured` (`structuredContent` only) to eliminate duplicate payload transmission for capable clients.
- **Admin Connector Profiles API:** `GET /api/connector-profiles` lists known actors with group token estimates; `PUT /api/connector-profiles/:actor` updates settings and appends a `connector.profile.update` audit event.
- **Connection modal UI:** Added "Tool surface" controls to the Connection Detail Modal with live token savings estimations per group.

### Changed - Result Shaping & Output Budgets

- **Edge result shaper:** Automatically shapes tool results at the MCP ingress edge (`handleJsonRpc`):
  - **S1 (Unwrap):** Unwraps `{ ok: true, value: X }` -> `X` on `shell_run`, `command_run`, and `command_run_many` items.
  - **S2 (Batch flattening):** Drops redundant array `index`, duplicate inner `path`, and default `sensitivity: NORMAL` in `file_read_many`, `file_write_many`, and `command_run_many`. Hoists `untrusted` notices once to the root envelope.
  - **S3 (Summary cleanup):** Omits `failed: 0` and `skipped: 0` from batch summaries.
  - **S4 (Command defaults):** Drops `signal: null` and empty `stderr: ""` from command execution records.
  - **S5 (Command output & budget):** Strips ANSI sequences, normalizes CRLF to LF, keeps the final state of carriage-return redrawn lines, collapses 3+ consecutive duplicate lines, and enforces `maxOutputChars` budget.
  - **S6 (Approval summaries):** `approval_status` and `approval_wait` return concise summaries by default unless `detail: "full"`, preventing multikilobyte payload consumption on approval polling loops.
  - **Content preservation:** Underlying file content in `file_read*` operations is strictly preserved byte-for-byte.
- **Configurable command budgets:** `maxOutputChars` input (integer 256–200,000, default 16,000) on `shell_run`, `command_run`, and `command_run_many`. Over-budget streams retain the first 25% and last 75% joined by `\n… [N chars omitted] …\n` and set `truncated: true`.

### Changed - Advertised Schema Compaction & Transport

- **Compact `tools/list`:** Stripped deprecated compatibility fields from host tools (`browser_*`, `desktop_*`, `control_*`), omitted default-false hints (`readOnlyHint`, `idempotentHint`), removed bare `{ type: 'object' }` output schemas, and shortened repeated workspace descriptions. Serialized default definition catalog is guarded at ≤ 54,000 characters (~20% reduction).
- **Transport optimizations:** Serializes responses once via `sendJsonBody`, memoizes serialized tool lists per enabled group set, and bounds in-memory activity log object depth and length before serialization.
- **HTTP response compression:** Automatically gzip-compresses MCP JSON responses of 1,024 bytes or larger when the client sends `Accept-Encoding: gzip` (`Vary: Accept-Encoding`). SSE event streams remain uncompressed.

### Fixed

- **Source-level ANSI sequence stripping:** Replaced partial control character stripping with `stripAnsiSequences` in `packages/security/src/untrusted.ts`, stripping complete CSI and OSC sequences so command outputs and approval previews no longer contain orphaned formatting artifacts such as `[90m` or `[2K`.
- **Browser CDP navigation retry:** Automatically retries transient `Not attached to an active page` CDP errors during navigation commits on Chromium, preventing intermittent page snapshot failures during fast navigation sequences.

## [1.1.4] - 2026-10-06

### Fixed - Desktop Helper Discovery

- `AEVRA_DESKTOP_HELPER_PATH` pointing at a missing file no longer hides the
  packaged helper. Aevra logs a warning and falls back to
  `dist/helper/<platform>-<arch>/` and local Cargo builds instead of failing
  with `DESKTOP_HELPER_NOT_INSTALLED`.
- An empty or whitespace-only `AEVRA_DESKTOP_HELPER_PATH` is treated as unset.
- `DESKTOP_HELPER_NOT_INSTALLED` now lists every path checked and names a stale
  override instead of telling you to set the variable that is already set. The
  same data is returned as `checkedPaths` and `missingOverride` error details.

### Fixed - Keep Awake

- The default keep-awake mode is now `always`, so a running Aevra blocks sleep
  without any setup. Saved settings are kept.
- `always` also keeps the display on. On Windows Modern Standby (S0 low power
  idle) laptops, turning the display off entered standby and dropped the network
  even while Aevra held a system-required request. The other modes still leave
  the display timeout alone.
- The keep-awake helper now exits with Aevra. Before, a crashed Aevra left the
  PowerShell, `caffeinate` or `systemd-inhibit` helper running and the machine
  awake.
- Aevra re-checks the helper on every 5-second poll and restarts it if it died.
  Windows reasserts the request every 5 seconds instead of 30, and macOS now
  also blocks system sleep on AC power (`caffeinate -i -s`).

### Changed - Quality Gate CI

- Pull requests run only the jobs their changed files need. Docs-only changes
  run static checks alone; web, extension, native helper and Node changes each
  run their own jobs. Workflow, dependency and unknown paths still run all.
- Branch pushes no longer start a second run next to the pull request. Pushes to
  `main` and manual dispatch still run every job, so release artifacts are
  unchanged. Tag releases on `main` commits.
- New `Quality gate result` job: require this single check in branch protection.
- Playwright browsers and Cargo builds are cached, Podman is installed only when
  missing, and helper tests reuse the release build.

## [1.1.3] - 2026-09-27

### Changed - Host Browser and Desktop Access

- Browser and desktop control now use grants on the exact AI connection, independent
  of workspace selection. A workspace grant alone cannot authorize host control;
  legacy workspace arguments on these tools are accepted but ignored for access.
- Browser control settings list paired profiles individually. Unpair revokes one
  profile while **Disconnect all browsers** revokes every profile and drops both
  browser transports.

### Added - Browser Actions

- `browser_act_many` accepts both flat actions such as
  `{ "op": "click", "x": 355, "y": 550 }` and single-key nested actions such as
  `{ "click": { "x": 355, "y": 550 } }`. Invalid forms return `INVALID_REQUEST`
  with the action index before dispatch.
- Coordinate `drag` presses, moves with the left button held, and releases in one
  action on both extension and CDP transports. It works on canvas and ordinary
  pages; a failed move attempts release before returning an error.
- Model-facing browser guidance prefers accessibility refs, then stable CSS
  selectors. Vision and coordinate actions are the fallback for canvas controls
  without semantic targets or failed semantic actions.

### Fixed - Browser Pairing Status

- `browser_status` now marks a paired, authenticated socket as
  `ready_to_connect` and returns the exact `browser_connect` call. The Admin UI
  shows that next step when a browser session has not yet been attached.
- A missing live extension socket now reports that state accurately instead of
  saying the saved pairing was lost.
- When an authenticated extension socket closes, browser status now clears the
  stale attached session and tab list instead of continuing to report connected.

### Fixed - Browser Tab Focus

- `browser_tabs {action:'focus'}` now selects the requested extension tab and
  brings its window forward. Tab listings report only the selected tab in the
  last focused window as active.

### Fixed - Vision Snapshots on Canvas and HiDPI Pages

- **Vision snapshot timeout**: the extension returned the viewport as a
  device-pixel PNG. On a large or HiDPI canvas page that PNG exceeded the 8 MiB
  extension frame, and the socket was dropped. The caller then waited for
  `BROWSER_TIMEOUT: snapshot exceeded 15000ms`. Both transports now capture a
  bounded JPEG of the visible viewport through a shared budget (1280 px longest
  edge, with quality and then size stepped down as needed), which fits the
  worker's 1 MiB IPC frame.
- **Fail fast on lost replies**: an oversized reply fails with
  `BROWSER_REPLY_TOO_LARGE`, and a disconnect fails with `BROWSER_UNAVAILABLE`,
  both immediately instead of after the RPC timeout. The extension refuses to
  send a frame the worker would reject.
- **Keep the extension alive during capture**: an authenticated socket sends a
  small keepalive every 20 seconds so Chromium does not suspend its MV3 service
  worker while a slow vision request is running. A capture error returns on that
  request and leaves the socket available for later browser commands.
- **Coordinate clicks on canvas apps**: extension coordinate clicks use a
  temporary Chrome debugger attachment for browser-native press and release
  events rather than page-generated events. Both transports convert `{x, y}`
  using the ratio of the tab's last vision capture. Extension vision capture
  uses the same temporary debugger viewport so the notice does not shift click
  positions relative to the screenshot. Ref and selector clicks keep their DOM
  action path.
- **Snapshot diagnostics**: capture stages and extension socket-close causes are
  retained for a pending vision request, making disconnects and timeouts easier
  to distinguish without exposing image or page content.
- **No extension error while Aevra is stopped**: Chrome logs every refused
  WebSocket as an extension error that cannot be caught. The extension now
  probes the listener over plain HTTP (the worker answers `426`) and dials only
  when the listener may be up. While Aevra is not running it logs one warning per
  outage and keeps retrying on the existing backoff.

## [1.1.2] - 2026-09-24

### Fixed - npm Runtime Packaging

- **Global CLI startup**: include the compiled browser, command-analysis, control,
  desktop, and MCP upstream modules required by the shipped runtime. This fixes
  `ERR_MODULE_NOT_FOUND` when starting the npm-installed CLI.
- **Package artifact verification**: add `npm run test:package` to pack and
  install the built artifact, check its relative JavaScript imports, and run
  the installed CLI's `--version` command. The full and portability gates run
  this check after building.

### Changed - Node Test Runner Isolation

- Give each normal and coverage test run a private `TEMP`/`TMP`/`TMPDIR` root
  and remove only that root after completion. Preserve the runner's original
  result if a test fails or cleanup itself encounters an error.
- On macOS, create the root under `/tmp` with a short name so nested Unix
  socket fixtures stay within the platform's socket path limit.

### Changed - Release CI

- Run the Quality gate for pushes to every branch. Release jobs wait up to two
  hours for that exact commit's push-triggered gate to succeed, then reuse its
  build artifacts. Code review approval is not a release gate.

## [1.1.1] - 2026-09-22

### Added - Guarded Control Plans & Cross-Platform Shared Desktop Semantics

- **Bounded local control plans**: added `control_observe`, `control_execute`,
  `control_plan_status`, `control_plan_cancel`, and `desktop_act_many`.
  Schema-version-1 plans support at most 32 typed steps, explicit dependencies,
  exact refs or unique exact locators, finite pre/postconditions, bounded output,
  a 60-second plan deadline, and `maxConcurrency` up to four. Independent
  surfaces can execute concurrently; same-surface work remains serialized.
- **Observation and context cache**: added owner/surface-scoped observations,
  immutable baseline IDs, event/validation epochs, generation invalidation,
  bounded history/bytes/images, delta continuations, compact full fallback, and
  deterministic context projection. Foreign owners cannot read another owner's
  cached observations or deltas.
- **Durable plan recovery**: migrations 017/018 add owner+request idempotency,
  a persisted keyed plan digest, redacted per-step dispatch records, and
  sanitized terminal step summaries. Raw set/type values and UI observations
  are not persisted. Incomplete plans become `unknown` on restart and are
  never blindly replayed; matching completed requests can reattach safely.
- **Cross-platform semantic desktop helper**: Windows keeps the existing UIA
  backend; macOS and Linux now have shared-semantic AX/AT-SPI2 providers through
  pinned `xa11y` 0.15.0. Portable mode supports accessibility-tree reads and
  provider invoke/value/select/toggle actions without host cursor, keyboard, or
  clipboard synthesis. Permission/provider failures are explicit rather than
  empty successful trees.
- **Native helper packaging**: quality-gate CI builds/tests release helpers on
  Windows, macOS, and Ubuntu. Release publishing downloads those exact validated
  artifacts, stages `dist/helper/<platform>-<arch>`, preserves executable bits,
  includes helpers in npm, and attaches native binaries to GitHub releases.
- **Shared desktop app catalog and access review**: added bounded Windows app
  discovery, host-stored custom app metadata, exact-path grants, and
  `desktop_request_access`. Requests are owner/window/process bound, expire after
  ten minutes, and require administrator review before a session or persistent
  grant is created. WebView2 grants require a verified native host relationship.

### Changed - Browser Target Isolation & Faster Actions

- **Browser script fast lane**: added `browser_execute_script`, a bounded
  Playwright-like CSS action grammar that compiles up to 32 statements into the
  existing typed browser action path. It never evaluates arbitrary JavaScript;
  navigation remains separate so URL DLP and origin policy cannot be bypassed.
- **Target-pinned CDP sessions**: CDP now holds a session per target. An explicit
  `tabId` attaches/acts on that target without bringing it to the foreground,
  and refs cannot cross target/snapshot boundaries.
- **Extension ref hardening**: extension snapshots/actions now use opaque element
  identities stored in Chrome's isolated world instead of page-writable
  `data-aevra-index` attributes. Credential-shaped field values are omitted
  from snapshots as well as remaining unwritable.
- **Non-activating extension capture**: a named inactive tab now returns
  `BROWSER_CAPTURE_REQUIRES_ACTIVE_TAB` rather than silently selecting it.
- **Policy ordering**: script/action parsing, bounds, and outbound DLP validation
  happen before MEDIUM/HIGH approval construction, keeping invalid or
  secret-bearing values out of approval payloads.
- **Strict isolation stays fail-closed**: `mode:"isolated"` never downgrades to
  the ordinary host worker. v1.1.1 returns `CONTROL_ISOLATION_UNAVAILABLE`
  until a separately provisioned runner has passed containment qualification.

### Changed - Activity and Approval Details

- **Structured activity and approval details**: added readable, expandable views
  for tool inputs/results and approval payloads, with raw-text mode and exact-value
  copy support for long or nested content.

### Fixed - Approval & Management UI

- **Long approval commands**: approval dialogs now cap themselves to the viewport,
  scroll the body, keep the action row reachable, and ellipsize long
  command/preview/matcher text. The full value remains available through the
  native title tooltip.
- **Runtime table scrollbar spacing**: contained management tables reserve a
  stable scrollbar gutter and right padding so filters and pagination are not
  covered by the vertical scrollbar.
- **Portable desktop outcome honesty**: AX/AT-SPI semantic actions revalidate
  focused-window identity after dispatch and do not report stale pre-action
  toggle state as a postcondition.

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
