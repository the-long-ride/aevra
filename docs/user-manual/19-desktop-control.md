# Desktop control

Aevra has two desktop-control paths in v1.3.1:

- **Shared semantic control** uses native accessibility providers and does not
  synthesize host mouse/keyboard input. It is available on Windows (UIA), macOS
  (Accessibility/AX), and Linux (AT-SPI2).
- **Legacy foreground control** injects pointer/keyboard input and captures pixels.
  Native adapters exist on Windows, macOS 13+, Ubuntu X11, GNOME Wayland and KDE KWin 6.6. They are never an automatic fallback from semantic control. macOS native acceptance is still pending. GNOME Wayland uses an explicitly enabled compositor companion; see [Wayland setup](22-wayland-desktop.md).

Desktop effects are external side effects: a button press cannot be rolled back by
Aevra's file change-set machinery.

## Platform matrix

| Platform             | Semantic tree/actions | Attribution                         | Pixel capture                                       | Foreground input                               |
| -------------------- | --------------------- | ----------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| Windows 10/11        | UIA                   | native process identity             | yes                                                 | integrity/desktop checks                       |
| macOS 13+            | AX                    | native process identity             | ScreenCaptureKit adapter; native acceptance pending | Accessibility grant; native acceptance pending |
| Linux X11            | AT-SPI2               | native process identity             | Composite backing pixmap                            | XTest, verified foreground target              |
| GNOME Wayland        | AT-SPI2               | compositor PID and stable window ID | isolated window actor through companion             | approved helper, verified focus and hit target |
| KDE KWin 6.6 Wayland | AT-SPI2               | compositor window/PID               | companion; software renderer verified               | explicit grant and guarded virtual devices     |
| Other Wayland        | AT-SPI2               | provider process identity           | pending                                             | pending                                        |

The helper reports actual capability booleans. Missing macOS Accessibility
permission, a missing Linux accessibility bus/provider, or an application with
accessibility disabled is an explicit error, not an empty successful tree.

Strict `isolated` execution is **not** advertised by the ordinary worker.
v1.3.1 refuses that mode with `CONTROL_ISOLATION_UNAVAILABLE` until a separately
provisioned runner has verified input/focus/clipboard containment. There is no
silent downgrade to the host desktop.

The [full parity design](../designs/2026-10-15-desktop-full-parity-design.md) is approved and partially implemented. Real isolated-X11 capture/input tests are included. A dedicated macOS fixture is included but needs a Mac with Screen Recording and Accessibility grants. Linux capture/input covers X11 and GNOME Wayland with its [companion setup](22-wayland-desktop.md). Native GNOME 50 acceptance passes; Ubuntu GNOME 46 has a required CI fixture. KWin 6.6 has a native companion with software-rendered acceptance. Native macOS acceptance remains outstanding.

## Before you start

- Grant `desktop.control` to the exact AI connection in **Dashboard → Connections → connection details**. It is off by default, independent of browser control, and needs no workspace selection. Workspace profiles do not grant it.
- Use an interactive desktop/session with the OS accessibility provider available.
- macOS 13+: grant Accessibility to the process running Aevra for control, and Screen Recording for capture, in System Settings > Privacy & Security. Permission changes require reconnecting; probes do not open consent dialogs.
- Linux: run inside the user's graphical session with an accessible AT-SPI bus;
  applications that disable their accessibility bridge cannot be driven
  semantically. For pixel capture/input select an X11 session, enable a compositing window manager and XTest, and install runtime libxkbcommon. For GNOME Wayland, install and enable the companion, enable access, approve the actual helper executable path in its panel menu, and reconnect. KDE KWin 6.6 uses its native companion and private helper-path grant; other Wayland compositors remain unsupported; there is no XWayland or privileged `/dev/uinput` fallback.
- Official packages stage the platform helper under
  `dist/helper/<platform>-<arch>/`. For source development, run
  `npm run build:local` from the repository root (requires Rust/Cargo); this
  builds JavaScript and the native helper. `npm run build` and `npm link`
  alone do not compile the helper. Alternatively, build `helper/` with
  `cargo build --release --manifest-path helper/Cargo.toml`.
  `AEVRA_DESKTOP_HELPER_PATH`
  overrides helper discovery when it names an existing file. A blank value is
  ignored. A missing file logs a warning and Aevra falls back to the packaged
  helper, then local Cargo builds. If nothing is found,
  `DESKTOP_HELPER_NOT_INSTALLED` lists every path that was checked.
- The `aevra start [--ui]` table shows `Desktop helper: ready` when a helper
  binary is discoverable, or `Desktop helper: missing` otherwise. This is a
  binary-presence check, not a guarantee that desktop permissions are granted
  or the native helper can connect.

## Tools

Base desktop tools:

| Tool                                                          | Purpose                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `desktop_connect` / `desktop_status` / `desktop_disconnect`   | helper lifecycle and capabilities                                          |
| `desktop_apps`                                                | configured/granted app labels only when using an allowlist                 |
| `desktop_request_access`                                      | ask a human administrator to review access for a freshly observed window   |
| `desktop_windows`                                             | visible top-level windows with attribution                                 |
| `desktop_describe`                                            | accessibility tree; background mode also creates a semantic snapshot/lease |
| `desktop_capture`                                             | Windows pixel capture; unsupported on portable semantic backends           |
| `desktop_click` `desktop_type` `desktop_key` `desktop_scroll` | explicit Windows foreground input                                          |
| `desktop_invoke`                                              | native invoke/press action                                                 |
| `desktop_set_value`                                           | native semantic value replacement                                          |
| `desktop_select`                                              | native selection action                                                    |
| `desktop_toggle`                                              | native toggle action                                                       |
| `desktop_release_window`                                      | release a background window lease                                          |

Efficient control tools:

| Tool                  | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `control_observe`     | bounded browser/desktop semantic observation               |
| `control_execute`     | validated finite local plan with guards and postconditions |
| `desktop_act_many`    | ordered semantic desktop batch convenience API             |
| `control_plan_status` | owner-bound durable plan status                            |
| `control_plan_cancel` | stop future steps of an owner-bound plan                   |

## Shared semantic workflow

For direct semantic tools:

1. Call `desktop_windows` and choose an attributed `windowId`.
2. Call `desktop_describe` with `mode:"background"`. Aevra creates an
   exclusive 60-second window lease and maps public refs to private provider
   handles.
3. Use `desktop_invoke`, `desktop_set_value`, `desktop_select`, or
   `desktop_toggle`.
4. A mutation invalidates that snapshot. Re-describe before another direct
   semantic action, or use a control plan so Aevra refreshes and verifies locally.
5. Release the lease explicitly when finished.

The portable AX/AT-SPI path rechecks the target process instance immediately before
dispatch and rechecks focused-window identity after dispatch. If an action was sent
but post-action state cannot be established, Aevra reports an unknown outcome rather
than retrying.

Protected/password controls do not expose their current value and never advertise a
set-value action.

## Efficient plans

`control_observe` returns an observation ID plus bounded semantic nodes. A
`control_execute` plan can then perform up to 32 typed steps with dependencies,
preconditions, and postconditions without returning to the model after every
action.

A plan target is either:

- a ref from the expected observation, or
- an exact, unique locator (role/name, optionally under an observed ancestor).

There is no fuzzy or positional fallback. If a rerender destroys a ref, only a
predeclared locator can bind the replacement. Ambiguity, a policy change, missing
context, or a new approval boundary produces a checkpoint instead of guessed input.

Request IDs are durable and owner-bound. Aevra stores a keyed plan digest, redacted
action/dispatch records, and sanitized terminal step summaries. Raw text values and
UI observations are not stored in the control-plan journal. After a daemon crash,
unfinished plans become `unknown` and are not replayed.

## Windows foreground control

`desktop_click`, `desktop_type`, `desktop_key`, and `desktop_scroll` are
legacy foreground tools for Windows. They remain useful for controls that have no
semantic UIA pattern, but they can interfere with the user's input state and are
never selected automatically by shared semantic plans.

Windows also refuses higher-integrity/elevated and non-default secure-desktop
targets. An unattributable target is denied unless the foreground policy explicitly
allows it; background semantic mutation remains stricter.

## Application policy and approvals

Settings → Desktop control controls which attributed applications can be touched.
Allow/deny policy, protected/admin-surface defenses, capability checks, DLP,
approvals, and audit rules remain in force for semantic batches. `desktop_act_many`
and `control_execute` call the existing desktop/browser tool paths rather than
creating a policy bypass.

### Windows app discovery and WebView2

The Settings app picker combines bounded scans of uninstall registrations, Start Menu
shortcuts, currently visible application windows, and registered packaged apps. It
shows which sources found each app and reports partial-source failures. Some portable
apps, closed tray apps, and applications without a usable executable mapping may not
appear. Restore a tray app to a visible window before using it; Aevra does not wake or
activate hidden windows to discover them. You can add an existing Windows `.exe` path
to the shared catalog. Custom names are stored by the Aevra host, so every authenticated
admin device sees the same entry.

For an app that uses WebView2, the window process is often the shared
`msedgewebview2.exe` runtime. Aevra does not infer the host from a title or guessed
process name. When the helper can verify the native window relationship, allowlisting
the host app grants only WebView2 windows attributed to that exact executable path.
When it cannot verify the relationship, access stays refused.

After a policy refusal, the agent may call `desktop_request_access` with the visible
`windowId` and a requested duration. This creates a pending request; it does not grant
access. Open Requests and choose Deny, Allow this session, or Persist for this app.
Requests expire after ten minutes and require the requesting desktop-control session
to remain active while they are reviewed. A grant does not bypass `desktop.control`,
per-action approvals, title protections, or Windows integrity and secure-desktop
checks. Persistent grants can be revoked in Settings → Desktop control. Enabling the
shared `msedgewebview2.exe` runtime directly is a broad rule and requires a separate
confirmation in the picker.

Legacy browser-local custom app entries can be imported from Settings. Aevra removes
each local entry only after the host confirms it was stored, so failed imports can be
retried from that browser.

`desktop_apps` uses the same catalog to label configured entries, but does not reveal
the full installed-app inventory to the model. In denylist mode it does not enumerate
apps because desktop control is not scoped to a selected app list.

The approval dialog itself is outside the desktop action contract. In v1.3.1 long
command previews are bounded with ellipsis, the dialog body scrolls within the
viewport, and its action row remains reachable.

## What is recorded

- Typed/set values are redacted; raw values are not written to control-plan step
  records.
- Screenshots are audited by content hash rather than persisted as raw pixels.
- Window titles and accessible names remain untrusted model-facing data and pass
  through the normal redaction boundary.
- Semantic operations and control-plan lifecycle events remain owner/audit bound.

## Turning it off

Revoke `desktop.control` or call `desktop_disconnect`. Disconnecting invalidates
live helper state and outstanding native refs. Standalone also rejects late connect completions and pending read results from the invalidated session; reconnect and observe again before using refs. Cancelling a control plan prevents
future plan steps but does not claim an already-dispatched external action was
rolled back.

## Current limits

- Strict isolated runner execution is fail-closed but not provisioned in v1.3.1.
- Native event/watch streams are not yet used by the public plan adapters; they
  report degraded watch health and perform bounded live refreshes between steps.
- Shared semantic actions do not synthesize host input. Explicit capture/input tools have
  separate native adapters and readiness checks on Windows, macOS 13+, Ubuntu X11,
  GNOME Wayland and KDE KWin 6.6; see the platform table above. macOS native acceptance
  and physical-GPU/production approval/lock acceptance remain outstanding.
- Frames, shadow DOM, and native custom controls may
  require a checkpoint or a different supported interface rather than guessing.
- Native helper binaries are not code-signed in this release.

## Read and capture policy

Accessibility reads and window captures apply the configured app policy before and after reading. Exact-path grants, including helper-verified WebView host grants, retain their session scope. Unattributed or denied targets return no accessibility content or pixels.

Full-screen capture requires HIGH approval and checks every enumerated window against policy. A protected window appearing during capture causes the image to be discarded. A permitted capture can return `window: null` because it represents the screen rather than a single app.

The Aevra title defense recognizes browser suffixes such as `Aevra - Google Chrome`. Titles remain attacker-controlled and show only the active tab; this check is defense in depth alongside app policy and approvals.

Window screenshots on Windows require a nonuniform `PrintWindow` result. If rendering fails or returns a uniform frame, capture is refused; it never falls back to screen pixels that may include other applications. Screen capture remains a separate policy scope.

## Native capture/input validation

Foreground input carries the exact process/window instance, executable and verified host that passed authorization. The native backend rechecks that target before new effects. Portable typing refreshes the bound accessible field path rather than scanning the desktop per character; focus/field changes stop the operation. A 7.5-second native input budget leaves room within the worker's 10-second helper deadline. A partial action returns `DESKTOP_OUTCOME_UNKNOWN`; observe again before sending more input.

The private X11 backend fixture also checks 280 Unicode characters within that budget, focus revocation before all four input operations, and revocation during typing with no new input delivered to the blocked window. The opt-in macOS fixture includes two editors and a non-key palette; actual macOS runtime acceptance still requires a granted local Mac session.

Run `cargo test --manifest-path helper/Cargo.toml --locked` for helper contracts.
On Linux, install Xvfb and x11-xkb-utils, then run:

```sh
cargo test --manifest-path helper/Cargo.toml --locked native_x11_capture_and_input -- --ignored --nocapture
```

This starts its own display and checks target pixels beneath an occluding sentinel plus actual click/key/wheel events. It never drives the user's open apps. A missing native prerequisite fails the explicit run.

On macOS, compile `helper/tests/fixtures/PortableMacFixture.swift` with `swiftc -framework AppKit`, grant the test host Screen Recording and Accessibility, and set `AEVRA_MAC_FIXTURE` to the resulting executable. Run `cargo test --manifest-path helper/Cargo.toml --locked native_macos_capture_and_input -- --ignored --nocapture`. It verifies real fixture pixels, Unicode text, a Command chord, a click and scrolling. This run has not been performed on the Windows development host.

Portable captures bind a unique native window by PID and exact bounds, recheck its process start time/native identity, and refuse ambiguity. Isolated window captures never substitute a full-screen crop. Images retain the existing capped JPEG wire format; `devicePixelRatio` reflects actual output pixels per logical coordinate. Ref clicks refresh the element and refuse stale, disabled or protected controls. Raw input never backs a failed semantic action.

For the accessible backend fixture, also install python3-gi, gir1.2-gtk-3.0, at-spi2-core and dbus-x11, then run:

```sh
AEVRA_GTK_FIXTURE="$PWD/helper/tests/fixtures/portable_gtk_fixture.py" \
dbus-run-session -- cargo test --manifest-path helper/Cargo.toml --locked native_x11_ -- --ignored --nocapture --test-threads=1
```

That path exercises the actual portable backend, rather than only the capture/input adapters, and checks exact Unicode entry text, selection/replacement with Ctrl+A, live ref clicks, protected-field refusal and window-attributed capture.
