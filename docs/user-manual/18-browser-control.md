# Browser control

Aevra can drive a real browser — read pages, click, type, navigate — under the
same capability, risk, approval, DLP, and audit controls that already govern
files and commands. This chapter installs the extension and wires it to your
browser profile.

## Before you start

Browser control needs the `browser.control` capability on the workspace, granted
the same way as `commands.run`. It is **off by default** and is **not** implied
by `network`. Until it is granted, every `browser_*` tool answers
`CAPABILITY_REQUIRED`.

Grant it in **Permissions → Workspace capabilities**.

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
   **Pair extension**.
2. Copy the 8-character code. It is single-use and expires after five minutes.
3. Open the extension's options page (**Details → Extension options** on
   `chrome://extensions`), paste the code, and select **Pair**.

The extension stores a MAC'd token that the Aevra worker verifies offline. It is
never displayed or logged again after pairing.

Once paired, ask your agent to connect:

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

## Keeping it up to date

The extension is versioned with Aevra, and `aevra extension install` always asks
for the archive matching the binary that is running. After upgrading Aevra, run
it again with `--yes` and the same directory, then reload the extension from
`chrome://extensions`. Because the path is unchanged, the id is unchanged and the
pairing survives.

## What it will not do

- **No page-script evaluation.** There is no `browser_evaluate`, on any
  transport. Every action is a typed, auditable operation.
- **No typing into credential fields.** Password, one-time-code, and payment
  fields are refused in the page and again in the worker. This is not
  policy-configurable and approval cannot override it — you type those yourself.
- **No privileged surfaces.** `chrome://`, `chrome-extension://`, `devtools://`,
  `file://`, `view-source:` and Aevra's own admin UI are refused outright.
- **No screenshots of sensitive origins.** Pixels cannot be DLP-redacted.
- **No navigation carrying secret-shaped data.** Navigate URLs are DLP-scanned
  across the query, the fragment, and the path.

## Turning it off

**Settings → Browser control → Disconnect all browsers** bumps a revocation
epoch. That invalidates every extension token ever issued and tears down both
transports immediately — not on the next operation. Re-pairing afterwards is the
same three steps as above.

Removing the extension from the browser also ends its reach, but the epoch is the
control that works when you cannot reach the browser.

## Residual risk

The extension holds `<all_urls>`, because the design chose all-tabs reach over
per-tab attach. Stated plainly: a browser-side compromise of the extension
reaches every tab in that profile regardless of Aevra's gate. That is the
accepted cost of that decision, and it is why the policy layer above it is as
strict as it is.
