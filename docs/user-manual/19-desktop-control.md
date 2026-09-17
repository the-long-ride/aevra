# Desktop control

Desktop control lets a model drive the computer Aevra runs on: read the
windows that are open, read the contents of one of them through the
accessibility API, take a screenshot, and click, type, press keys, and
scroll.

It is the most powerful thing Aevra can do and the hardest to take back. A
file write is recoverable through `change_rollback`; a click is not. Read
"What it will not do" and "Residual risk" below before you turn it on.

## What ships today

**Windows only.** The Windows helper is implemented and tested. macOS and
Linux are **not implemented at all** - not partially, not read-only. There
is no helper binary for them, so `desktop_connect` on those platforms fails
with `DESKTOP_HELPER_NOT_INSTALLED`.

The table below is the _design target_ for the four capabilities the helper
reports at connect, reproduced from the design document. Only the Windows
row describes shipped behaviour:

| Platform        | capture                     | tree                    | attribution | input                                    |
| --------------- | --------------------------- | ----------------------- | ----------- | ---------------------------------------- |
| Windows 10/11   | yes                         | UIA                     | yes         | yes - never into elevated windows (UIPI) |
| macOS 13+       | yes (TCC: Screen Recording) | AX (TCC: Accessibility) | yes         | yes (TCC: Accessibility)                 |
| Linux / X11     | yes                         | AT-SPI                  | yes         | yes                                      |
| Linux / Wayland | portal only                 | AT-SPI, partial         | no          | **no - read-only**                       |

When the other platforms land, Linux under Wayland will be **read-only**:
it cannot attribute a window to a process, and this feature refuses to
type into a window it cannot attribute. Do not plan around parity.

`desktop_status` reports those four booleans for the host you are actually
on, so the model learns "no input here" once instead of discovering it
through a series of failures.

## Before you start

- Windows 10 or 11.
- The desktop helper binary, built from `helper/` with `cargo build
--release`. There is no installer for it yet, and it is not signed - see
  "Residual risk".
- The `desktop.control` capability granted to the session. It is off by
  default and is not implied by any other capability.
- A real interactive desktop session. A service running with no desktop, or
  a locked screen, has nothing to read or click; capture refuses a blank
  screen rather than returning a black rectangle.

## The ten tools

| Tool                                                          | What it does                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| `desktop_connect`                                             | Starts the helper and reports its capabilities              |
| `desktop_status`                                              | Answers even when nothing is connected                      |
| `desktop_disconnect`                                          | Stops the helper and invalidates every element reference    |
| `desktop_windows`                                             | Lists visible top-level windows with their process identity |
| `desktop_describe`                                            | Accessibility tree of one window, as `ref_N` handles        |
| `desktop_capture`                                             | A screenshot, only when asked for                           |
| `desktop_click` `desktop_type` `desktop_key` `desktop_scroll` | Input                                                       |

## How a model is meant to use it

Read the tree, not the screen. `desktop_describe` returns named elements
with stable-for-now `ref_N` handles, and `desktop_click` takes one of those
refs. That is both cheaper and more accurate than looking at pixels and
guessing coordinates - a screenshot-per-step loop costs tens of thousands
of tokens across a task that the tree does for a fraction of it.

Every action returns a **delta** (`focusChanged`, `newWindow`,
`subtreeChanged`) so the model does not have to re-read the screen after
every click to find out whether anything happened. If the delta also
carries `postActionStateUnknown: true`, the action really did happen but
Aevra could not see the result, and the screen should be re-read before
anything is concluded from it.

A `ref_N` belongs to the `desktop_describe` that produced it. If the helper
restarts, or a newer describe supersedes it, using the old ref fails with
`DESKTOP_REF_STALE` instead of clicking whatever now occupies that
position. Call describe again; do not fall back to coordinates.

## Screenshots

`desktop_capture` returns a JPEG data URI and a `devicePixelRatio`.

Things worth knowing before relying on it:

- **It is lossy and size-capped.** The image is JPEG at quality 60 with its
  longest edge capped at 1024 pixels. That is deliberate: the data URI is
  billed as text, so its bytes are your tokens. Read text with
  `desktop_describe`, which is exact and far cheaper; use capture for
  layout, canvas, and game surfaces.
- **With no `windowId` it captures the primary monitor**, not the focused
  window. This is the only capture whose pixels map back to clickable
  coordinates: `screenX = imageX / devicePixelRatio`.
- **A window capture is not coordinate-mappable.** The result carries no
  origin, so there is no way to convert a pixel in a window screenshot into
  a screen coordinate. Look at it, then click by ref.
- **Monitors other than the primary cannot be captured** for the same
  reason. That is a gap, not a design decision, and it needs an origin
  field on the wire to fix.
- **A blank result is an error, not an image.** A locked or sleeping
  display, or a window that blocks capture, produces a uniform frame, and
  Aevra refuses it. A black rectangle returned as a successful screenshot
  would be worse than no screenshot: the model would reason confidently
  about a screen nobody ever saw.

## What it will not do

**Reads and input fail differently, on purpose.** Screen reading is always
permitted. Input is refused whenever Aevra cannot say which application
would receive it.

- **It cannot type into an elevated window.** Windows itself refuses input
  injection from an unelevated process into a more privileged one (UIPI),
  and Aevra runs unelevated. A UAC consent prompt is therefore a hard stop,
  enforced by the operating system rather than by a setting. Aevra reports
  it as `DESKTOP_INPUT_REFUSED` rather than as success.
- **It refuses input to a window it cannot attribute.** A window whose
  owning executable cannot be read - the secure desktop, some elevated
  processes - has no process identity, and input to it is refused. You can
  opt out with `unattributedInput: 'allow'` in the desktop policy, which
  means "type into windows I cannot identify"; do not do that casually.
- **It refuses input to a denylisted application.** By default that covers
  terminals and shells (`cmd.exe`, `powershell.exe`, `pwsh.exe`,
  `WindowsTerminal.exe`, `conhost.exe`), password managers (1Password,
  KeePass, KeePassXC, Bitwarden, Dashlane, LastPass), and the elevation and
  credential dialogs (`consent.exe`, `CredentialUIBroker.exe`,
  `LogonUI.exe`).
- **It does not drag, use the clipboard, run OCR, record video, or move and
  resize windows.** None of that is implemented.

### The admin UI defense is partial, and you should know why

The first thing this feature must not be able to drive is Aevra's own admin
UI - an agent that can click Approve can approve its own requests. But that
UI is a web page, so at window granularity its identity is _the browser's_
process, and denylisting your browser would remove the single surface a
desktop agent most needs.

So the protection is a title-pattern refusal: input is refused when the
focused window's title is exactly `Aevra`, which is the title Aevra's own
web UI sets. That is defense in depth and nothing more. Two specific holes,
stated plainly because they are easy to overlook:

- **Window titles are set by the page.** Any web page can call
  `document.title`, so a title match is never proof of identity - and any
  page can also avoid the match.
- **It is blind to background tabs.** A browser window reports the title of
  its _active_ tab. With the admin UI open in a background tab, the window
  shows some other title, passes this check, and a single Ctrl+Tab away is
  the approval button.

Treat "the agent cannot reach the approval button" as likely, not certain,
and keep approvals somewhere the agent has no hands - your phone, or a
machine it is not driving.

## What gets recorded

- **Typed text is never logged.** The audit record for `desktop_type`
  carries the character count and the target, never the characters. The
  same is true of the approval prompt, so a passphrase typed through this
  tool is not written to disk in the clear.
- **Screenshots are never persisted.** The audit record stores a SHA-256
  hash of the image; the image itself goes to the caller and is dropped.
- **Window titles and accessible names pass through DLP redaction** before
  the model sees them. They are attacker-influenceable text and are treated
  as untrusted content, not as instructions.
- **Every action records the gate verdict and the rule that decided it**,
  including reads - so a screenshot leaves a row in the audit trail too.

## Turning it off

Revoke the `desktop.control` capability, or call `desktop_disconnect`, which
stops the helper process and invalidates every outstanding element
reference. With the capability revoked, the tools refuse before reaching the
helper.

## Residual risk

- **The helper binary is unsigned.** Windows SmartScreen may warn about it.
  Authenticode signing is planned and is not required for the feature to
  work.
- **A click cannot be rolled back.** Aevra's change/rollback machinery
  covers files, not the world outside them. `desktop_click` currently goes
  through the gate but not through the approval flow, so there is no
  per-click confirmation to lean on yet.
- **There is no human-takeover abort.** If you grab the mouse while an
  agent is acting, nothing stops it. That needs a low-level input hook and
  is not built.
- **The gate judges the window that has focus at the moment of the check.**
  For `desktop_type` and `desktop_key` there is a small window between that
  check and the injection during which focus could move - a race an
  application could in principle lose you keystrokes into. Prefer clicking
  a named element to typing blind.
- **`desktop_scroll` targets the window under the pointer**, not the window
  the gate judged, and skips the pre-flight checks a click makes.
