# Browser control

Aevra can drive a real web browser — read pages, click, type, navigate — through
the same capability, risk, approval, DLP, and audit controls that already govern
files and commands.

## What it is

Ten `browser_*` tools on Aevra's existing `/mcp` endpoint:

| Tool                     | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `browser_connect`        | Attach to a transport                                         |
| `browser_status`         | Pairing state and epoch                                       |
| `browser_disconnect`     | Drop the session                                              |
| `browser_tabs`           | List, open, close, focus                                      |
| `browser_navigate`       | Go to a URL                                                   |
| `browser_snapshot`       | Accessibility tree with refs, or a labelled screenshot        |
| `browser_read`           | Page text or HTML                                             |
| `browser_act_many`       | Ordered click / type / press_key / scroll / select / wait_for |
| `browser_execute_script` | One bounded Playwright-like CSS action script                 |
| `browser_logs`           | Console or network entries                                    |

Because they are ordinary MCP tools, every already-connected client (ChatGPT,
Claude, Grok) gets them with no new integration.

## Turning it on

Browser control needs the `browser.control` capability, granted per workspace
like `commands.run`. It is **off by default** and is **not** implied by
`network`. Without it every `browser_*` tool returns `CAPABILITY_REQUIRED`.

## The two transports

**Extension** keeps the logged-in sessions you already have. `aevra extension
install` fetches the archive for your version and unzips it where you choose, or
you can download it from a release yourself; the step-by-step is in the user
manual, chapter [Browser control](user-manual/18-browser-control.md), and the
build route is in `apps/extension/README.md`. Then pair once from
**Settings → Browser control → Pair extension**.

**CDP** attaches to a browser you started yourself:

```bash
chrome --remote-debugging-port=9222
```

Then call `browser_connect` with `{ "transport": "cdp", "cdpPort": 9222 }`.

The tool names are identical either way, so an agent's plan survives a transport
switch.

## Target identity and non-activation

CDP keeps a debugger session per target. Supplying `tabId` selects that target
without activating it, so background automation does not change the user's selected
tab merely to read or act.

The extension likewise keeps public refs separate from page content. Snapshot refs
map to opaque element identities held in Chrome's isolated world; Aevra no longer
uses page-writable `data-aevra-index` attributes as action authority. Navigation or
a newer snapshot makes old refs stale rather than rebinding them.

## Vision mode

`browser_snapshot` with `mode: "vision"` returns a viewport screenshot plus
labelled boxes, and the act operations accept `{x, y}` coordinates instead of an
element ref. This is a mode on both transports — not a third transport, and not a
separate tool.

Boxes and `{x, y}` are in the screenshot's own pixel space, so a model can point
at what it sees. The snapshot reports `devicePixelRatio`, the image-pixels-per-CSS-pixel
scale used: CDP captures at CSS scale and so reports 1, while the extension
transport captures at the display's ratio, because its capture API offers no
scale control. Without this the two spaces differ on any HiDPI display and every
coordinate click lands short of its target.

Chrome's extension capture API can only capture the visible tab. If an explicit
`tabId` names an inactive tab, Aevra returns
`BROWSER_CAPTURE_REQUIRES_ACTIVE_TAB` rather than activating it. CDP capture is
target-scoped and does not require this activation.

## Fast Playwright-like scripts

`browser_execute_script` reduces model round trips when the target selectors are
already known. The model sends one script plus an optional `tabId`; Aevra parses
it into the same typed `browser.act` operations used by `browser_act_many` and
executes the batch under one serialized browser operation.

The accepted language is intentionally not JavaScript. It supports CSS
`page.locator(...).click()`, `.fill(...)`, `.type(...)`, and
`.waitFor(...)`, plus `page.getByText(...).waitFor(...)` and
`page.keyboard.press(...)`. Scripts are bounded to 32 statements and cannot
navigate. Use `browser_navigate` separately so destination-origin policy and
navigation DLP checks remain explicit.

This path skips the snapshot/ref round trip when CSS selectors are sufficient,
but it does not skip policy: capability checks, origin risk, approvals, outbound
DLP, credential-field refusal, auditing, and the per-session execution lock all
still apply.

## What it will not do

- **No arbitrary page-script evaluation.** There is no `browser_evaluate`.
  `browser_execute_script` parses a fixed non-Turing-complete action grammar;
  it never passes JavaScript to the page or CDP `Runtime.evaluate`.
- **No credential value egress or typing.** Password, one-time-code, payment,
  and other credential-shaped input values are omitted from extension snapshots;
  typing to those fields is refused in the content script and again in the worker. This is not
  policy-configurable and approval cannot override it — you type those yourself.
- **No privileged surfaces.** `chrome://`, `chrome-extension://`, `devtools://`,
  `file://`, `view-source:` and Aevra's own admin UI are refused outright, never
  ticketed. Otherwise an agent could re-permission itself through Aevra's UI.
- **No screenshots of sensitive origins.** Pixels cannot be DLP-redacted, so
  there is nothing an approval could make safe.
- **No navigation carrying secret-shaped data.** Navigate URLs are DLP-scanned
  across the query, the fragment, and the path; any part holding an opaque
  payload blocks the call. That covers `browser_tabs {action:'open'}`, which
  navigates exactly as `browser_navigate` does.

## Transport differences

The tool surface is identical on both transports, but one capability is not:

- **Network logs** come only from CDP. `browser_logs {kind:'network'}` returns an
  empty list on the extension transport rather than pretending otherwise.

Console logs work on both. On the extension transport they are captured by
patching `console` in the page's own world and relaying each line through the
isolated world, re-established on every snapshot and navigation. Capture starts
when Aevra first touches a tab, so lines the page logged before that are not in
the buffer. Page scripts share that world, so a page can post entries of its own

- console output is page-attested either way, and travels to the model as
  untrusted content.

## One operation at a time

A tab is shared mutable state with no transactions, so the worker holds the
browser session exclusively for the length of each page operation. Two `act`
batches submitted at once run one after the other rather than interleaving their
clicks, and a snapshot cannot land between another batch's steps. Connect,
disconnect, and status deliberately stay outside that queue: the kill switch has
to reach a wedged session, not wait behind it.

## Risk tiers

| Situation                                                                   | Tier   | Behaviour               |
| --------------------------------------------------------------------------- | ------ | ----------------------- |
| `snapshot` / `read` / `logs` / `tabs` on a normal origin                    | LOW    | runs                    |
| `click` / `type` / `press_key` / `select` / script batch on a normal origin | MEDIUM | per capability profile  |
| First navigation to a domain not yet seen this session                      | MEDIUM | per capability profile  |
| Any operation on a sensitive origin                                         | HIGH   | approval ticket         |
| Leaving a sensitive origin for another origin                               | HIGH   | approval ticket         |
| Any operation on a blocked origin                                           | —      | refused, never ticketed |

Sensitive origins are banking, email, cloud consoles, identity providers, and
any page carrying a password field. Approvals appear in the web UI's Requests
drawer showing the origin, operation, and target.

Page text, snapshots, and logs all return wrapped as untrusted content: a page
instructing the agent to take an action is data, not a command.

## Kill switch

**Settings → Browser control → Disconnect all browsers** bumps a revocation
epoch. That invalidates every extension token ever issued and tears down both
transports immediately — not on the next operation.

## Residual risk

The extension holds `<all_urls>`, because the design chose all-tabs reach over
per-tab attach. Stated plainly: a browser-side compromise of the extension
reaches every tab regardless of Aevra's gate. That is the accepted cost of that
decision, and it is the reason the policy layer above is as strict as it is.
