# Aevra Browser Control — Design

Date: 2026-09-05
Status: implemented in 1.0.5, hardened per docs/specs/2026-09-07-browser-control-hardening-design.md

## 1. Goal

Let an AI client connected to Aevra drive a real web browser — read pages, click, type, navigate — through the same capability, risk, approval, DLP, and audit controls that already govern files and commands.

Two transports reach the browser:

- **Extension** — an Aevra-authored MV3 extension the user installs in their everyday Chromium browser, keeping their existing logged-in sessions.
- **CDP** — a direct Chrome DevTools Protocol connection to a browser the user launched with `--remote-debugging-port`.

**Vision-by-screenshot is not a third transport.** It is a mode available on both: `browser_snapshot mode:'vision'` returns an image with labelled boxes, and act operations accept `{x, y}` coordinates instead of an element ref. One tool surface, not one per perception style.

**MCP is not a transport either.** It is how the feature is reached: the browser tools are ordinary `browser_*` tools on Aevra's existing `/mcp` endpoint, so every already-connected client (ChatGPT, Claude, Grok) gets them with no new integration.

Done looks like: a user installs the extension, pairs it once from the Aevra web UI, and their AI client completes a multi-step task in a live browser tab — every action tiered by risk, sensitive origins gated behind approval, and the whole run in the audit log.

## 2. Non-goals

- No arbitrary JavaScript evaluation in the page (`browser_evaluate`). Every action is a typed, auditable operation.
- No OS-level mouse/keyboard injection, no native input dependency.
- No Firefox in v1.
- No full-page screenshot stitching in v1 (viewport capture only).
- No revival of the removed legacy browser protocol. `packages/protocol/test/protocol.unit.test.ts` asserts `boundProjectSchema`, `handoffSnapshotSchema`, and `wsClientMessageSchema` are gone; none of them return. This design introduces new names only, and that test stays green unchanged.

## 3. Architecture

```
ChatGPT / Claude --/mcp--> apps/core ----ipc----> apps/worker
                            (authorize, risk,      (execute; owns sessions)
                             approval, audit,          |
                             DLP)                      +-- CdpDriver --ws--> Chrome --remote-debugging-port
                                                       +-- ExtensionDriver --ws(127.0.0.1:47833)--> Aevra MV3 extension
```

The existing boundary holds: core authorizes and never opens a socket to a browser; worker executes and never reads policy state. Browser control is just another executor behind the signed operation envelope.

### 3.1 Package changes

| Location                                                                       | Change                                                                      |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `packages/protocol/src/browser.ts`                                             | new — `BrowserOp` union, operation kinds                                    |
| `packages/protocol/src/index.ts`                                               | add `browser.control` to `Capability`                                       |
| `packages/browser/`                                                            | new package — drivers, session registry, origin policy, extension WS server |
| `packages/mcp-tools/src/browser-tools.ts`                                      | new — 9 tool handlers                                                       |
| `packages/mcp-tools/src/registry-input-schemas.ts`, `registry-schema-parts.ts` | add browser tool schemas                                                    |
| `apps/worker/`                                                                 | mount extension WS server + driver registry                                 |
| `apps/core/`                                                                   | pairing route, epoch push, risk tiering wiring                              |
| `apps/extension/`                                                              | new — MV3 extension                                                         |
| `apps/web-react/`                                                              | new Browser panel                                                           |

New operation kinds on the existing signed envelope (`version: 1`, MAC'd, TTL'd): `browser.connect`, `browser.tabs`, `browser.navigate`, `browser.snapshot`, `browser.read`, `browser.act`, `browser.logs`, `browser.disconnect`. No new trust path is introduced. browser_status is served from the local session registry and carries no envelope, so eight operation kinds back nine tools.

### 3.2 Driver abstraction

`packages/browser/src/driver.ts` exports one interface:

```ts
export interface BrowserDriver {
  connect(opts: ConnectOptions): Promise<SessionInfo>;
  tabs(action: TabAction): Promise<TabInfo[]>;
  navigate(req: NavigateRequest): Promise<NavigateResult>;
  snapshot(req: SnapshotRequest): Promise<SnapshotResult>;
  read(req: ReadRequest): Promise<ReadResult>;
  act(actions: BrowserAction[], opts: ActOptions): Promise<ActResult[]>;
  logs(req: LogsRequest): Promise<LogEntry[]>;
  disconnect(): Promise<void>;
}
```

`CdpDriver` and `ExtensionDriver` implement it. MCP tool names never mention the transport, so the agent's plan survives a transport switch.

**Accepted trade-off:** the interface is the intersection of both transports. CDP-only powers (network throttling, `Page.printToPDF`, request interception) are dropped in v1 rather than leaked through a per-transport escape hatch. If evidence shows they are needed, the follow-up is capability negotiation on `browser_connect` — deliberately deferred as YAGNI.

**Rejected alternative:** separate `browser_ext_*` and `browser_cdp_*` tool families. Maximum per-transport fidelity, but roughly 26 tools, and every prompt and skill would hardcode a transport.

## 4. Extension transport

### 4.1 Pairing

1. Web UI -> **Settings → Browser control** -> **Pair extension**. Core mints an 8-character pairing code: TTL 5 minutes, single use, stored in the core store. The CLI does not mint pairing codes because opening the Web UI is required to establish browser trust for Aevra's self-signed TLS certificate.
2. User pastes the code into the extension's in-popup pairing modal or options page.
3. Extension calls `POST https://127.0.0.1:47831/api/browser/pair {code, extensionId}` (with fallback to `http://`) on the loopback-only admin port. The existing CSRF middleware gets a narrow `chrome-extension://` origin exemption scoped to this one route.
4. Core returns `{token, wsUrl}`. The extension stores it in `chrome.storage.local`.

The token is `{extensionId, epoch, issuedAt, expiresAt}` plus a MAC signed with the **daemon key already used for operation-envelope MACs**.

Rationale: the worker must verify the token without reading the core store — the boundary tests forbid that import. A MAC'd token verifies offline. Revocation works by core bumping `epoch` and pushing the new value to the worker over existing IPC, which kills every older token at once and gives the web-UI kill-switch real force.

### 4.2 Socket

Worker binds `ws://127.0.0.1:47833` (`AEVRA_BROWSER_PORT`), **bound to 127.0.0.1, never 0.0.0.0**.

MV3 service workers cannot set WebSocket headers, so authentication is the first frame: `{type:'auth', token}` within 3 seconds or the socket closes. The worker additionally pins the `Origin: chrome-extension://<id>` header against the paired extension id, so another local process holding a stolen token still fails.

### 4.3 Frames

```
worker -> ext   { id, type: 'cmd', op: 'act'|'snapshot'|'navigate'|..., params }
ext -> worker   { id, type: 'result'|'error', payload }
ext -> worker   { type: 'event', name: 'tab.updated'|'tab.closed'|'detached', payload }
```

Per-operation timeout 15s by default; explicit `{type:'cancel', id}`. One socket per paired extension. Reconnect with backoff is driven from the extension side.

### 4.4 Extension internals

- **Service worker** — RPC peer and tab registry.
- **Content script** — injected on demand via `chrome.scripting.executeScript`, not declared in the manifest, so nothing runs in a page until an operation targets that tab.
- **Snapshot** — builds an accessibility-oriented tree with `ref_N` ids held in a per-version `WeakMap`. A stale ref returns `REF_STALE`; it never resolves to a different element.
- **Screenshot** — `chrome.tabs.captureVisibleTab`, viewport only.

### 4.5 CDP transport

No pairing. The worker connects to `http://127.0.0.1:<port>/json`, selects a page target, speaks CDP directly, and presents the same `BrowserDriver` surface.

## 5. Security model

The user chose all-tabs reach over per-tab attach, so the extension carries `<all_urls>` and the policy layer is the only wall. Everything below exists because of that decision.

### 5.1 Capability

New `browser.control`, off by default, granted per workspace like `commands.run`. It is **not** implied by `network`. Without it, every `browser_*` tool returns `CAPABILITY_REQUIRED`.

### 5.2 Origin classes

Every operation resolves the target tab's origin into one of three classes:

- **BLOCKED** (default, editable): `chrome://*`, `chrome-extension://*`, the Aevra web UI itself, and the extension's own options page. Non-negotiable by design — otherwise the agent can re-permission itself through Aevra's own UI.
- **SENSITIVE** (default list plus user additions): banking, email, cloud consoles, identity providers, and any page containing a password field.
- **NORMAL**: everything else.

### 5.3 Risk tiering

| Situation                                                          | Tier   | Behaviour                                             |
| ------------------------------------------------------------------ | ------ | ----------------------------------------------------- |
| `snapshot` / `read` / screenshot on NORMAL                         | LOW    | auto-run                                              |
| `click` / `type` / `press_key` / `select` on NORMAL                | MEDIUM | per capability profile                                |
| First navigation to a registrable domain not yet seen this session | MEDIUM | per capability profile                                |
| **Any operation on SENSITIVE**                                     | HIGH   | approval ticket showing origin, operation, target ref |
| Any operation on BLOCKED                                           | —      | refused, never ticketed                               |

### 5.4 Credential fields

The content script refuses to type into `input[type=password]`, `autocomplete=one-time-code`, and `cc-*` fields, returning `CREDENTIAL_FIELD_REFUSED`. This is not policy-configurable and approval cannot override it. The user types those values themselves.

### 5.5 Page content is untrusted input

Snapshots, page text, console logs, and network logs return through the existing untrusted-content wrapper (`untrusted: true` plus notice) already used by `file_read_many`, and through DLP redaction. A page instructing the agent to take an action is data, not a command.

### 5.6 Exfiltration

The sharpest edge: `browser_navigate` to an attacker-controlled URL carrying stolen text in the query string is a working exfiltration channel that no approval on _click_ would catch. Mitigations:

- Navigate URLs are DLP-scanned for secret-shaped values and blocked on hit. `packages/security/src/browser-url-policy.ts` scans the query string, the fragment, and each path segment separately, so a secret moved out of a query parameter is caught too.
- Cross-origin navigation while a SENSITIVE tab is attached is HIGH risk.

### 5.7 Screenshots

Screenshots are pixels and cannot be DLP-redacted. Screenshots of SENSITIVE origins are therefore refused outright, with no approval path: there is nothing an approval could make safe, so the user takes that screenshot themselves. Images are stored as content hashes in the audit log, with the image bytes written to the existing `recovery/` retention path rather than inline in the database. Screenshot here means the vision-mode snapshot; there is no separate screenshot tool.

### 5.8 Audit and kill-switch

Every operation logs `{origin, tabId, op, ref or coords, outcome, riskTier, approvalId?}`. The web UI carries a **Disconnect all browsers** control that bumps the epoch and tears down drivers; every token dies and both transports drop.

### 5.9 Extension supply chain

No third-party libraries, no remote code (MV3 forbids it regardless), strict CSP, and permissions limited to `tabs`, `scripting`, `storage`, `<all_urls>`.

**Residual risk, stated plainly:** `<all_urls>` means a browser-side compromise of the extension reaches every tab regardless of Aevra's gate, and extension store review will question the permission. This is the accepted cost of the all-tabs decision.

## 6. Tool surface

Following the repository's existing batch idiom (`file_read_many`, `command_run_many`), the surface is 9 tools rather than one per verb.

| Tool                 | Arguments                                                  | Returns                                              |
| -------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| `browser_connect`    | `{transport: 'extension'\|'cdp', cdpPort?, tabId?}`        | sessionId, transport, attached tabs                  |
| `browser_status`     | `{}`                                                       | live session, transport, tabs, per-tab origin class  |
| `browser_disconnect` | `{}`                                                       | teardown acknowledgement                             |
| `browser_tabs`       | `{action: 'list'\|'open'\|'close'\|'focus', url?, tabId?}` | tab list                                             |
| `browser_navigate`   | `{tabId?, url, waitUntil?: 'load'\|'idle'}`                | final url, status, redirect chain                    |
| `browser_snapshot`   | `{tabId?, mode: 'a11y'\|'vision', maxNodes?}`              | a11y tree with `ref_N`, or image plus labelled boxes |
| `browser_read`       | `{tabId?, ref?, selector?, kind: 'text'\|'html'}`          | DLP-redacted, untrusted-wrapped content              |
| `browser_act_many`   | `{tabId?, actions: [...], stopOnError?}`                   | per-action results                                   |
| `browser_logs`       | `{tabId?, kind: 'console'\|'network', limit?, since?}`     | log entries                                          |

`browser_act_many` action shapes:

- `click {ref}` or `click {x, y}`
- `type {ref, text, clear?}`
- `press_key {key}`
- `scroll {ref?, x?, y?, dx, dy}`
- `select {ref, value}`
- `wait_for {ref? | text?, timeoutMs}`

Vision mode is exactly the `{x, y}` variant of the act operations — same tool, same audit shape, no separate code path.

There is no separate `browser_screenshot` tool; screenshots are `browser_snapshot mode:'vision'`.

Schemas are added to `registry-input-schemas.ts` and `registry-schema-parts.ts` alongside the existing ones, and handlers go through the same `authorization.ts` capability check as every other tool.

## 7. Testing strategy

`@playwright/test` and `jsdom` are already devDependencies, so no new test infrastructure is required.

- **Driver conformance suite** (load-bearing): one table-driven suite executed twice, once per driver, against fakes. This is what keeps the abstraction from drifting into two dialects.
- **Unit**: ref staleness returns `REF_STALE`; origin classifier; credential-field refusal; token MAC verification; epoch revocation; DLP URL-parameter scan.
- **Contract**: `browser.*` envelope kinds accepted and unknown kinds rejected, extending `packages/protocol/test/protocol.unit.test.ts`; extension WS frame protocol; IPC additions.
- **Security**: BLOCKED origins unreachable; SENSITIVE escalates to a HIGH ticket; screenshot blocked on sensitive origin; page text carries the untrusted wrapper; boundary test asserting `apps/core` never imports `packages/browser`.
- **Integration**: worker plus a fake extension socket end-to-end; `CdpDriver` against a real headless Chromium launched from the Playwright browser binary with `--remote-debugging-port`.
- **Extension**: content-script logic as pure functions under jsdom; service worker RPC against a fake `chrome` object.
- **UI parity**: Playwright coverage for the web UI Browser panel.

The 85% coverage floor and `npm run test:gate` apply unchanged.

## 8. File layout

All files stay under the 350-line `.ts` / 400-line `.tsx` limits enforced by `scripts/loc-lint.mjs`.

```
packages/protocol/src/browser.ts            operation kinds, BrowserOp union
packages/browser/src/driver.ts              BrowserDriver interface + types
packages/browser/src/cdp-driver.ts
packages/browser/src/extension-driver.ts
packages/browser/src/extension-server.ts    worker-side WS listener, auth, origin pin
packages/browser/src/registry.ts            session registry, teardown, epoch
packages/browser/src/origin-policy.ts       BLOCKED/SENSITIVE/NORMAL + risk tiering
packages/browser/test/                      conformance + unit suites
packages/mcp-tools/src/browser-tools.ts     9 tool handlers
apps/worker/src/                            mount extension-server + registry
apps/core/src/                              pairing route, epoch push, risk wiring
apps/extension/src/service-worker.ts        RPC peer, tab registry
apps/extension/src/content.ts               snapshot, act, read
apps/extension/src/options.ts               pairing code UI
apps/extension/manifest.json
apps/web-react/src/                         Browser panel
```

## 9. Build order

1. `packages/protocol` browser kinds + `BrowserDriver` interface + conformance suite skeleton.
2. `CdpDriver` — testable end-to-end with no extension in play.
3. Extension WS server + MV3 extension + pairing flow.
4. MCP tools + core risk, approval, DLP, and audit wiring.
5. Web UI Browser panel and kill-switch.

## 10. Open questions

None blocking. Deferred by decision: capability negotiation per transport, Firefox support, full-page screenshot stitching, and CDP-only capabilities (throttling, PDF export, request interception).
