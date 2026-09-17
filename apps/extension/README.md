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

Nothing runs in a page until an operation targets that tab, and then only
through `chrome.scripting.executeScript` — the manifest declares no content
scripts. There is no arbitrary script evaluation: every action is a typed,
auditable operation. Typing into password, one-time-code, and payment fields is
refused in the content script as well as in the worker, and no approval can
override it.

## Residual risk

This extension holds `<all_urls>`, because the design chose all-tabs reach over
per-tab attach. Stated plainly: a browser-side compromise of this extension
reaches every tab regardless of Aevra's gate, and extension store review will
question the permission. That is the accepted cost of that decision.
