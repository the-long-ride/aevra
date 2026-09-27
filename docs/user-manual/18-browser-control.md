# Browser control

Aevra can drive a real browser — read pages, click, type, navigate — under the
same capability, risk, approval, DLP, and audit controls that already govern
files and commands. This chapter installs the extension and wires it to your
browser profile.

## Before you start

Browser control requires a separate `browser.control` host grant for the exact AI
connection. In **Dashboard → Connections**, open the connection and grant **Browser
control**. No workspace selection is needed. Workspace capability profiles and
`network` access do not grant browser control. A missing grant starts a local
approval request. File and command access remain scoped to workspaces.

## Install the extension

The extension is plain compiled JavaScript — no bundler, no signed package. It
is published as `aevra-extension.zip` on the release matching the Aevra you are
running, and it loads through your browser's own **Load unpacked** control.

There is no `.crx`. A Chromium browser refuses to install one that did not come
from its own web store, so shipping one would have looked like an install route
without being one.

### Let Aevra fetch it

```bash
aevra extension install
```

This downloads the archive for the running version, asks where to unzip it, and
prints the load steps. The default location is inside Aevra's state directory,
which is deliberate — see [Keep the folder where it is](#keep-the-folder-where-it-is).

To skip the question, name the directory:

```bash
aevra extension install --dir ~/aevra-browser
```

The folder is created if it does not exist. If a previous copy is already there,
the command stops and tells you; re-run with `--yes` to replace it.

### Or download it yourself

1. Download `aevra-extension.zip` from the
   [latest release](https://github.com/the-long-ride/aevra/releases/latest).
2. Unzip it. You get one folder, `aevra-extension`.

### Load it

1. Open `chrome://extensions` (`edge://extensions` on Edge).
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose the `aevra-extension` folder — the one
   containing `manifest.json`.

The extension requests the `debugger` permission so vision captures and coordinate
clicks or drags use the same viewport while canvas interactions receive browser-native input.
The browser may show a debugger notice while either operation runs. When updating an already loaded unpacked
extension, Chrome or Brave may pause it until you accept the new permission
warning in the extensions page. Accept the warning and reload the same folder;
its saved pairing remains associated with that folder path.

### Managed fleets

Point `ExtensionSettings` policy at the unzipped folder on each machine. Because
there is no signed package, there is no store id to force-install from.

## Keep the folder where it is

Chrome derives an unpacked extension's id from the absolute path it was loaded
from, and the pairing below is bound to that id. Move or rename the folder and
the browser treats it as a different extension: it silently stops working and
has to be paired again.

So put it somewhere permanent before pairing. Not `/tmp`, not `Downloads`, not a
folder you plan to tidy. `aevra extension install` defaults into Aevra's state
directory for exactly this reason.

## Choose the profile Aevra drives

An extension belongs to one browser profile. Whichever profile you load it in is
the one Aevra can see and act in — that profile's tabs, that profile's logged-in
sessions, and no other. If you keep work and personal profiles apart, load it
only in the one you want an agent to reach.

## Pair it with this Aevra

The extension does nothing until it holds a token from your own Aevra.

1. In the Aevra web UI open **Settings → Browser control** and select
   **Pair extension**. Note: the CLI does not generate pairing codes because opening
   the Web UI in this browser profile is what establishes trust for Aevra's self-signed TLS certificate.
2. Copy the 8-character code. It is single-use and expires after five minutes.
3. Click the Aevra extension icon in your browser toolbar to open the popup, select
   **Pair with Aevra** (or open the extension's options page), paste the code, and select **Pair**.

The extension stores a MAC'd token that the Aevra worker verifies offline. It is
never displayed or logged again after pairing.

Settings → Browser control lists each paired browser profile separately. Aevra
identifies the profile with a stable profile ID, so separate Chrome profiles can
have separate rows even when they use the same extension ID. Only one paired
profile can own the live extension socket at a time; the profile that
authenticates most recently becomes active.

Select **Unpair** on a row to revoke only that profile's token. Its extension
will show **Pair again** and needs a new code. Other paired profiles remain
authorized. Use **Disconnect all browsers** to clear every pairing and revoke
all extension tokens.

The extension popup separates **Pairing saved** (a token is stored),
**Connecting** (Aevra is temporarily unreachable and the extension retries),
**Connected** (the worker authenticated the socket), and **Pair again** (the
saved token was rejected). A saved pairing alone does not mean the worker is
listening or that a browser session is attached. The Aevra Browser control
settings show listener, authenticated socket, and attached browser status.
If the popup says **Pair again**, generate a new code and pair again. If the
listener reports a port failure, free port 47833 or configure another browser
port, then restart Aevra.

Once paired and granted host browser access, ask your agent to connect:

If Settings says **Extension socket authenticated** and **Browser not attached**,
the pairing is working. Ask the agent to call `browser_connect` with the input
below. `browser_status` also returns `ready_to_connect` and this next action.
If the extension socket disconnects, Aevra reports the browser as detached;
after the popup shows **Connected** again, ask the agent to reconnect.

```json
{ "transport": "extension" }
```

## Without the extension: attach over CDP

If you would rather not install anything, start a browser with debugging enabled
and point Aevra at it:

```bash
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/aevra-browser
```

Then call `browser_connect` with `{ "transport": "cdp", "cdpPort": 9222 }`.

Use a separate `--user-data-dir`. A debugging port on your everyday profile
exposes every logged-in session on that profile to any local process, not just
to Aevra.

The tool names are identical on both transports, so an agent's plan survives a
switch. One thing differs: network logs come only from CDP.

## Background tabs and refs

For AI browser control, use an accessibility snapshot and its element refs
first. A stable CSS selector or bounded `browser_execute_script` is the next
choice when the target is known. Use a vision screenshot and coordinate input
for canvas or WebGL controls without semantic targets, or after a semantic
action failed. Extension vision and coordinate actions can briefly attach
Chrome debugger. Choose points from a fresh image and verify the result with
another snapshot; `ok:true` confirms delivery, not the intended page state.
If you explicitly ask for a coordinate action, the AI can send it directly.

An explicit `tabId` does not mean Aevra will bring that tab to the foreground.
CDP attaches to that target directly. Extension refs are backed by opaque
isolated-world element identities, not attributes the page can rewrite.

One exception is extension **vision capture**: Chrome can only capture the visible
tab. If you request a screenshot of a named inactive tab, Aevra refuses with
`BROWSER_CAPTURE_REQUIRES_ACTIVE_TAB` instead of switching tabs behind you. Use
`browser_tabs` with `action: "focus"` to select that tab and bring its window
forward, then capture it, or use
accessibility mode or CDP.

For a canvas point from a vision image, call `browser_act_many` with
`{"actions":[{"op":"click","x":355,"y":550}]}`. Aevra also accepts
`{"actions":[{"click":{"x":355,"y":550}}]}`. Coordinates are in the last
vision image's pixel space, and malformed actions return `INVALID_REQUEST`
with the action's array index.

For a held mouse movement on a game canvas or an ordinary page, use
`{"actions":[{"op":"drag","x":355,"y":550,"toX":520,"toY":550}]}`.
Aevra presses at the first point, moves with the left button held, and releases
at the second. Both points use the last vision image's coordinates, or CSS
pixels before any vision capture. The nested `{"drag":{...}}` form also works.

Vision snapshots and coordinate clicks or drags each use a temporary debugger attachment.
This keeps screenshot coordinates aligned if the debugger notice changes the
game viewport. Clicks send native mouse press and release events to the selected
tab; ref and CSS selector clicks use
the existing DOM action path. An `ok:true` result means the browser accepted
the click, so capture another snapshot to confirm the intended game screen
opened. `BROWSER_NATIVE_INPUT_UNAVAILABLE` means Chrome refused the debugger
attachment, for example because DevTools already owns the tab;
`BROWSER_INPUT_FAILED` means an input or detach command failed. Aevra does not
retry either failure with synthetic page events.

## Faster multi-step actions

When the agent already knows stable CSS selectors, it can avoid a
snapshot → refs → action round trip with `browser_execute_script`. For example:

```json
{
  "tabId": "target-tab-id",
  "script": "await page.locator(\"#query\").fill(\"Aevra\"); await page.locator(\"#search\").click(); await page.getByText(\"Results\").waitFor({ timeout: 5000 });"
}
```

This is Playwright-like syntax, not JavaScript execution. Aevra accepts only CSS
`locator(...).click/fill/type/waitFor`, `getByText(...).waitFor`, and
`keyboard.press`, with at most 32 statements. It compiles those statements to
the same typed browser action batch used elsewhere. Navigation remains a
separate `browser_navigate` call so origin and DLP checks cannot be bypassed.

## Keeping it up to date

The extension is versioned with Aevra, and `aevra extension install` always asks
for the archive matching the binary that is running. After upgrading Aevra, run
it again with `--yes` and the same directory, then reload the extension from
`chrome://extensions`. Because the path is unchanged, the id is unchanged and the
pairing survives.

## What it will not do

- **No arbitrary page-script evaluation.** There is no `browser_evaluate`.
  The Playwright-like fast path is a fixed action grammar and never evaluates
  JavaScript in the page.
- **No credential value egress or typing.** Credential-shaped field values are
  omitted from extension snapshots, and password, one-time-code, and payment
  fields refuse model typing in the page and again in the worker. This is not
  policy-configurable and approval cannot override it — you type those yourself.
- **No privileged surfaces.** `chrome://`, `chrome-extension://`, `devtools://`,
  `file://`, `view-source:` and Aevra's own admin UI are refused outright.
- **No screenshots of sensitive origins.** Pixels cannot be DLP-redacted.
- **No navigation carrying secret-shaped data.** Navigate URLs are DLP-scanned
  across the query, the fragment, and the path.

## Turning it off

**Settings → Browser control → Disconnect all browsers** bumps a revocation
epoch. That invalidates every extension token ever issued and tears down both
transports immediately — not on the next operation. To remove one profile only,
use its **Unpair** button in the paired profile list; that profile must complete
the same three pairing steps above before reconnecting.

Removing the extension from the browser also ends its reach, but the epoch is the
control that works when you cannot reach the browser.

## Residual risk

The extension holds `<all_urls>`, because the design chose all-tabs reach over
per-tab attach. Stated plainly: a browser-side compromise of the extension
reaches every tab in that profile regardless of Aevra's gate. That is the
accepted cost of that decision, and it is why the policy layer above it is as
strict as it is.
