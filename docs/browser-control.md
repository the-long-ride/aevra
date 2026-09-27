# Browser control

Aevra can drive a real web browser — read pages, click, type, navigate — through
the same capability, risk, approval, DLP, and audit controls that already govern
files and commands.

## What it is

Ten `browser_*` tools on Aevra's existing `/mcp` endpoint:

| Tool                     | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `browser_connect`        | Attach an authorized AI connection to a transport                    |
| `browser_status`         | Pairing, live socket, and attachment state                           |
| `browser_disconnect`     | Drop the session                                                     |
| `browser_tabs`           | List, open, close, focus                                             |
| `browser_navigate`       | Go to a URL                                                          |
| `browser_snapshot`       | Accessibility tree with refs, or a labelled screenshot               |
| `browser_read`           | Page text or HTML                                                    |
| `browser_act_many`       | Ordered click / drag / type / press_key / scroll / select / wait_for |
| `browser_execute_script` | One bounded Playwright-like CSS action script                        |
| `browser_logs`           | Console or network entries                                           |

Because they are ordinary MCP tools, every already-connected client (ChatGPT,
Claude, Grok) gets them with no new integration.

## Turning it on

Browser control requires an independent `browser.control` host grant for the
exact AI connection. Grant it from **Dashboard → Connections → connection
details**. No workspace selection is needed. A workspace capability profile,
including `network`, cannot authorize browser control. Missing access creates
a local approval request; files and commands remain workspace-scoped.

## The two transports

**Extension** keeps the logged-in sessions you already have. `aevra extension
install` fetches the archive for your version and unzips it where you choose, or
you can download it from a release yourself; the step-by-step is in the user
manual, chapter [Browser control](user-manual/18-browser-control.md), and the
build route is in `apps/extension/README.md`. Then pair once from
**Settings → Browser control → Pair extension**.

Pairing saves a browser-profile credential and authenticates its socket. The
authorized AI connection then calls `browser_connect` with
`{ "transport": "extension" }` to attach a browser session. When the socket is
authenticated but no browser is attached, `browser_status` reports
`connectionState: "ready_to_connect"` and the exact `nextAction` tool call.
If the extension socket closes, `browser_status` clears the attached session
and cached tabs. Once the extension reconnects, call `browser_connect` again.

**CDP** attaches to a browser you started yourself:

```bash
chrome --remote-debugging-port=9222
```

Then call `browser_connect` with `{ "transport": "cdp", "cdpPort": 9222 }`.

The tool names are identical either way, so an agent's plan survives a transport
switch.

## Paired browser profiles

Browser control settings keeps one pairing row per browser profile. Multiple
profiles can share the same Chromium extension ID and still be paired and
unpaired independently. Each row shows whether its profile currently owns the
extension socket. Only one extension profile can own that socket at a time; the
most recently authenticated paired profile becomes active.

Use **Unpair** on one row to revoke that profile's token and require it to pair
again. Other rows stay paired. **Disconnect all browsers** remains the global
kill switch and revokes every profile token.

## Target identity and non-activation

CDP keeps a debugger session per target. Supplying `tabId` selects that target
without activating it, so background automation does not change the user's selected
tab merely to read or act.

The extension likewise keeps public refs separate from page content. Snapshot refs
map to opaque element identities held in Chrome's isolated world; Aevra no longer
uses page-writable `data-aevra-index` attributes as action authority. Navigation or
a newer snapshot makes old refs stale rather than rebinding them.

## Vision mode

### Choosing an action target

For LLM-driven browser work, start with `browser_snapshot` in `a11y` mode and
act on its element `ref`. If a known, stable CSS selector describes the target,
use that selector with `browser_act_many` or `browser_execute_script`. Refresh
the accessibility snapshot if a ref becomes stale.

Use `vision` and screenshot coordinates only when the control has no usable
semantic target (for example, a canvas or WebGL game), or a semantic action
failed to produce the intended result. On the extension transport, vision and
coordinate click or drag may attach Chrome debugger and show its
notice. Choose coordinates from a fresh screenshot, then take another snapshot
to confirm the intended page change; an `ok:true` action only confirms input
delivery. An explicit request to click or drag at coordinates can use that
action directly.

`browser_snapshot` with `mode: "vision"` returns a viewport screenshot and
best-effort labelled boxes. The act operations accept `{x, y}` coordinates instead of an
element ref. This is a mode on both transports — not a third transport, and not a
separate tool.

Boxes and `{x, y}` are in the screenshot's own pixel space, so a model can point
at what it sees. The snapshot reports `devicePixelRatio`, the image-pixels-per-CSS-pixel
scale of the image it returned, and the driver converts later `{x, y}` actions
back by the ratio of that tab's last vision capture. Before any vision capture,
coordinates are taken as CSS pixels.

Both transports capture only the visible viewport, from the composited surface,
so canvas, WebGL, video and streamed content appear exactly as the user sees
them. Extension capture takes the screenshot before attempting DOM labels. If
DOM inspection fails or takes over one second, it returns the image with empty
boxes. This keeps canvas-only and briefly loading pages usable. Capture does not
wait for the network or an idle page, because a game that renders every frame
never goes idle. The image is a JPEG at CSS scale,
with the longest edge capped at 1280 px. If the frame still exceeds the transport
budget, quality and then size are stepped down until it fits. The capture fails
with `BROWSER_CAPTURE_TOO_LARGE` only when even the smallest attempt does not
fit. The budget is what keeps the image inside the extension socket and the
worker IPC frame; an unbounded HiDPI PNG used to exceed both and surface as
`BROWSER_TIMEOUT`.

If a reply is still too large for the extension socket, the call fails at once
with `BROWSER_REPLY_TOO_LARGE`. If the extension disconnects mid-call, it fails
at once with `BROWSER_UNAVAILABLE`, not after the RPC timeout.
The worker reassembles fragmented WebSocket messages before parsing screenshot
replies, so a large canvas image does not disconnect the extension solely
because the browser split its reply across frames.
For a vision request, a disconnect error also includes `close` and `stage`.
`close=peer_replaced` means another extension socket took over. With
`close=remote_close`, `stage=capture_started` points to capture, while
`stage=capture_api_done` points to image processing. `stage=encode_done` means
the image was prepared before the connection closed. These are diagnostic
markers, not a claim that the requested image reached the AI client.
If a vision request times out while the socket stays connected, its
`BROWSER_TIMEOUT` message includes the last `stage` as well. If the extension
popup stays at **Connecting** while Aevra's listener is running, reload the
unpacked extension so it uses the current connection code.
The extension sends a small keepalive on its authenticated socket every 20
seconds, including while a slow screenshot request is pending, to prevent MV3
service-worker suspension. A failed capture returns an error for that request;
the browser session remains available while the socket is healthy.

Extension vision snapshots and coordinate clicks or drags use short-lived Chrome debugger
attachments. Chromium can show a debugger notice that changes the page's
viewport; capturing and acting with the notice present keeps their coordinates
aligned. A click sends browser-native mouse press and release events to the
requested tab. Ref and CSS selector clicks continue through the extension's
isolated-world DOM action path. A successful action means Chrome accepted the
input; take another snapshot to verify that the page changed as expected.

`drag` works on canvas and ordinary pages through both extension and CDP. It
presses at `{x,y}`, moves toward `{toX,toY}` with the left button held, then
releases automatically. All four coordinates are in the last vision image's
pixel space, or CSS pixels if there was no vision capture. The gesture stays
within one action; a failed move attempts release before returning an error.

The unpacked extension requires Chrome's `debugger` permission for vision
snapshots and coordinate clicks or drags. On update, Chrome or Brave may disable it until you accept the new
permission warning in the extensions page and reload it. The existing pairing
is retained when you reload the same unpacked folder. If DevTools or another
debugger already owns the tab, the click returns
`BROWSER_NATIVE_INPUT_UNAVAILABLE`; an input or detach failure returns
`BROWSER_INPUT_FAILED`. Neither failure silently retries with page-generated
events.

Chrome's extension capture API can only capture the visible tab. If an explicit
`tabId` names an inactive tab, Aevra returns
`BROWSER_CAPTURE_REQUIRES_ACTIVE_TAB` rather than activating it. CDP capture is
target-scoped and does not require this activation.

## Browser action input

`browser_act_many` takes ordered actions with an `op` field. For a point chosen
from the vision screenshot, send `{"actions":[{"op":"click","x":355,"y":550}]}`.
The equivalent nested form `{"actions":[{"click":{"x":355,"y":550}}]}` is
also accepted. Aevra validates each action before dispatch and reports
`INVALID_REQUEST` with its array index for malformed input.
To hold and move the mouse across a page, send
`{"actions":[{"op":"drag","x":355,"y":550,"toX":520,"toY":550}]}`.
The nested form `{ "drag": { "x": 355, "y": 550, "toX": 520, "toY": 550 } }`
is accepted too. Release happens within the same action.

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

A saved extension token is **Pairing saved**; only an authenticated socket is
**Connected**. A listener bind failure is shown in Aevra settings. Transient
worker unavailability keeps the extension retrying, while a rejected token
shows **Pair again**. `browser_status` reports core configuration, listener
health, socket authentication, and browser attachment separately.

## Kill switch

**Settings → Browser control → Disconnect all browsers** bumps a revocation
epoch. That invalidates every extension token ever issued and tears down both
transports immediately — not on the next operation.

## Residual risk

The extension holds `<all_urls>`, because the design chose all-tabs reach over
per-tab attach. Stated plainly: a browser-side compromise of the extension
reaches every tab regardless of Aevra's gate. That is the accepted cost of that
decision, and it is the reason the policy layer above is as strict as it is.
