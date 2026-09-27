# Aevra Browser Control extension

An MV3 extension that lets Aevra drive your everyday browser, keeping the
logged-in sessions you already have, under Aevra's capability, risk, approval,
DLP, and audit controls.

## Build and load

```bash
npm run build:extension
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
and select `apps/extension/build/aevra-extension`.

The manifest requests `debugger` for vision captures and coordinate clicks or drags. If Chrome or Brave
disables an existing unpacked installation after this permission is added,
accept its warning on the extensions page and reload the same folder. Keeping
the folder path preserves the extension ID and saved pairing.

The compiler emits into a repo-shaped tree, because the extension imports shared
source from `packages/` and those relative imports have to keep resolving inside
the packed extension. `build:extension` assembles that tree with a manifest whose
paths point into it and with the compiled tests left out, which is why the load
target is `build/aevra-extension` rather than `dist`.

The same command also writes `build/aevra-extension.zip`, which is the artifact
releases publish and the one `aevra extension install` downloads. Its entries are
nested under `aevra-extension/`, so unzipping it anywhere yields a single folder
to point Load unpacked at.

Nothing is signed and there is no `.crx`. A Chromium browser refuses to install
one that did not come from its own web store, so shipping a signed package would
have looked like an install route without being one.

Chrome derives an unpacked extension's id from the folder path it was loaded
from, and pairing is bound to that id. Rebuilding in place keeps the pairing;
moving or renaming the folder silently ends it.

Users install from a release rather than from source. That route, and wiring a
browser profile to Aevra, is documented in the user manual chapter
[Browser control](../../docs/user-manual/18-browser-control.md).

## Pair

1. In the Aevra web UI, open the **Browser** panel and select **Pair extension**.
2. Copy the 8-character code. It is single-use and expires after five minutes.
3. Open the extension's options page, paste the code, and select **Pair**.

The extension stores a MAC'd token that the Aevra worker verifies offline. The
web UI's **Disconnect all browsers** control bumps an epoch that invalidates
every issued token at once.

## What it can and cannot do

Vision captures and coordinate clicks or drags each use a temporary `chrome.debugger`
attachment so the debugger notice cannot change the game layout between the
screenshot and input. Clicks send native mouse press/release commands on the exact
target tab. Drags send a held press, stepped movement, and release in one action
for canvas and ordinary pages. Ref and selector actions
use `chrome.scripting.executeScript` in the isolated world. There is no
arbitrary script evaluation or general debugger command surface: every action
remains typed and auditable. Typing into password, one-time-code, and payment
fields is refused in the content script as well as in the worker, and no
approval can override it. A coordinate click returning `ok:true` confirms
input delivery, so use a follow-up snapshot to verify a page-state change.

## Residual risk

This extension holds `<all_urls>`, because the design chose all-tabs reach over
per-tab attach. Stated plainly: a browser-side compromise of this extension
reaches every tab regardless of Aevra's gate, and extension store review will
question the permission. That is the accepted cost of that decision.
