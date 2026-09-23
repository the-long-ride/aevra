# Desktop control

Aevra has two desktop-control paths in v1.1.2:

- **Shared semantic control** uses native accessibility providers and does not
  synthesize host mouse/keyboard input. It is available on Windows (UIA), macOS
  (Accessibility/AX), and Linux (AT-SPI2).
- **Legacy foreground control** injects pointer/keyboard input and captures pixels.
  That path remains Windows-only and is never an automatic fallback from semantic
  control.

Desktop effects are external side effects: a button press cannot be rolled back by
Aevra's file change-set machinery.

## Platform matrix

| Platform          | Semantic tree/actions                      | Attribution                                | Pixel capture | Foreground input                         |
| ----------------- | ------------------------------------------ | ------------------------------------------ | ------------- | ---------------------------------------- |
| Windows 10/11     | UIA: invoke/value/select/toggle            | yes                                        | yes           | yes, subject to integrity/desktop checks |
| macOS             | AX: supported provider actions/values      | yes                                        | no in v1.1.2  | no                                       |
| Linux X11/Wayland | AT-SPI2: supported provider actions/values | yes when provider exposes process identity | no in v1.1.2  | no                                       |

The helper reports actual capability booleans. Missing macOS Accessibility
permission, a missing Linux accessibility bus/provider, or an application with
accessibility disabled is an explicit error, not an empty successful tree.

Strict `isolated` execution is **not** advertised by the ordinary worker.
v1.1.2 refuses that mode with `CONTROL_ISOLATION_UNAVAILABLE` until a separately
provisioned runner has verified input/focus/clipboard containment. There is no
silent downgrade to the host desktop.

## Before you start

- Grant the session the `desktop.control` capability. It is off by default.
- Use an interactive desktop/session with the OS accessibility provider available.
- macOS: grant Accessibility permission to the process running Aevra when macOS
  requests it.
- Linux: run inside the user's graphical session with an accessible AT-SPI bus;
  applications that disable their accessibility bridge cannot be driven
  semantically.
- Official packages stage the platform helper under
  `dist/helper/<platform>-<arch>/`. For source development, build
  `helper/` with `cargo build --release`. `AEVRA_DESKTOP_HELPER_PATH`
  overrides helper discovery and is authoritative when set.

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

The approval dialog itself is outside the desktop action contract. In v1.1.2 long
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
live helper state and outstanding native refs. Cancelling a control plan prevents
future plan steps but does not claim an already-dispatched external action was
rolled back.

## Current limits

- Strict isolated runner execution is fail-closed but not provisioned in v1.1.2.
- Native event/watch streams are not yet used by the public plan adapters; they
  report degraded watch health and perform bounded live refreshes between steps.
- macOS/Linux shared mode is semantic-only in v1.1.2: no pixel capture and no host
  input synthesis.
- Frames, shadow DOM, canvas-only browser controls, and native custom controls may
  require a checkpoint or a different supported interface rather than guessing.
- Native helper binaries are not code-signed in this release.
