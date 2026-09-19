# Browser Control Hardening — Design

Date: 2026-09-07
Status: implemented

## 1. Goal

Browser control shipped in 1.0.5. An audit of the shipped subsystem against
`docs/specs/2026-09-05-aevra-browser-control-design.md` found seven defects, one of which
defeats a control that design called non-negotiable, one of which makes the
extension transport unusable on a default install, and one of which is a defense
that design describes but the code never implemented.

This design fixes all seven and closes the drift between that spec and the code.

Done looks like: Aevra's own admin surfaces stay unreachable to the agent no
matter which ports the operator configured, the user decides how the rest of
loopback is treated, the extension pairs on a default install, and the two
transports agree about timeouts.

## 2. Non-goals

- No new `browser_*` tools and no change to the tool surface.
- No new transport, no Firefox, no revisiting the all-tabs decision.
- No change to the capability model, the envelope, or the core/worker boundary.
- No redesign of DLP itself; `redactText` stays the single classifier.

## 3. Findings

| #   | Severity | Location                                                                  | Defect                                                                                                                         |
| --- | -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | High     | `packages/browser/src/origin-policy.ts:21-22`                             | Aevra's own ports are a hardcoded literal set; a configured port leaves the admin UI classified NORMAL                         |
| 2   | High     | `apps/extension/src/options.ts:3`                                         | Pairing posts to `http://127.0.0.1:47831`; admin listens TLS-only whenever a cert exists, which is the default                 |
| 3   | Medium   | `packages/browser/src/extension-driver.ts:41` + `extension-server.ts:187` | Per-call timeout fixed at 15s, so `wait_for` above 15s fails on the extension transport but works on CDP                       |
| 4   | Medium   | `packages/browser/src/registry.ts:31`                                     | Worker epoch initialises to 0 while core's persisted epoch starts at 1; sockets are refused until a `browser_connect` syncs it |
| 5   | Low      | `packages/mcp-tools/src/browser-risk.ts:31`                               | `resetVisited` is called only from tests, so the visit ledger grows for the process lifetime                                   |
| 6   | Low      | `packages/mcp-tools/src/browser-tools.ts`                                 | Audit rows hardcode `redactionCount: 0`                                                                                        |
| 7   | Medium   | `packages/mcp-tools/src/browser-tools.ts`                                 | Page content is never DLP-redacted; `redactText` is reached from one place in the codebase, and it is not this one             |

Finding 1 is the serious one. `classifyOrigin` returns BLOCKED for loopback only
when both the host and the port match; the ports are literals `47830`-`47833`
while `apps/core/src/config.ts:101` reads each from the environment. An operator
who sets `AEVRA_ADMIN_PORT` gets an admin UI the agent may drive, which is the
self-repermissioning path the original spec §5.2 forbade.

### 3.1 Verified sound, unchanged by this design

The capability gate fires before tab enumeration, so an unauthorised session
cannot list the user's tabs. `refuseBlockedOrigin` runs against both the
navigate URL and the resolved tab. Credential-field refusal exists on both
transports. Token verification uses `timingSafeEqual` with strict epoch
equality, so finding 4 fails closed rather than resurrecting revoked tokens.
The pairing code is consumed before validation. None of this changes.

### 3.2 Spec drift, code stricter than its design

The browser-control spec understates two defenses. §5.6 describes query
parameter scanning; `packages/security/src/browser-url-policy.ts` scans query,
fragment, and each path segment separately. §5.7 says sensitive screenshots are
allowed with approval; `refuseSensitiveScreenshot` refuses them outright with no
approval path. §3.1 says nine tool handlers and §8 says eight; nine is correct.
The header still reads "pending implementation plan". §10 of this document
corrects all four.

## 4. Design

### 4.1 Origin policy reads real ports, and the operator classifies the rest

`classifyOrigin` gains its port set and its loopback rule from configuration
instead of literals. `OriginPolicyConfig` extends to:

```ts
export interface OriginPolicyConfig {
  blockedHosts: string[];
  sensitiveHosts: string[];
  hasPasswordField: boolean;
  /** Live Aevra listener ports. Always BLOCKED; not operator-editable. */
  aevraPorts: number[];
  /** Everything else on loopback. Operator's call. */
  loopbackClass: 'BLOCKED' | 'SENSITIVE' | 'NORMAL';
}
```

Two rules, in order:

1. A loopback host on any port in `aevraPorts` is BLOCKED. Not configurable, not
   overridable by approval — this is the rule that stops the agent reaching the
   surface that grants its own capabilities.
2. Any other loopback host takes `loopbackClass`, default **SENSITIVE**.

SENSITIVE as the default is deliberate. A local dev server is the plausible
reason to point the agent at loopback at all, so BLOCKED by default would break
a real use; NORMAL by default silently exposes every other local admin console
on the machine. SENSITIVE keeps it working behind a HIGH-risk approval, and an
operator who finds that noisy sets NORMAL knowingly.

**Config flows to the classifier.** Today `browser-tools.ts` calls
`classifyOrigin(url)` with no config at all, so even the existing
`blockedHosts` and `sensitiveHosts` fields are dead. A `BrowserOriginPolicyService`
in `apps/core/src/browser/` reads settings key `browser.originPolicy`, merges
the live ports from `CoreConfig`, and is injected as `context.deps.browserPolicy`
alongside the existing `browserPairing`. Every `classifyOrigin` call site passes
its snapshot.

The ports come from `CoreConfig` (`publicPort`, `adminPort`, `mcpPort`) plus
`AEVRA_BROWSER_PORT`, read at service construction. `hasPasswordField` keeps
its current per-call meaning.

**Rejected:** re-reading `process.env` inside `origin-policy.ts`. The package is
reached from the worker as well as from core, and a policy that depends on which
process evaluates it is a policy nobody can reason about.

### 4.2 Pairing over TLS

`popup.ts` (and `options.ts`) posts to `https://127.0.0.1:<port>/api/browser/pair` and falls back
to `http://` only when the TLS attempt fails at the transport, which covers an
install running without a certificate.

Aevra's certificate is self-signed, and an MV3 service worker cannot bypass a
certificate error. The flow already resolves this: the pairing code is generated
in the admin web UI (**Settings → Browser control**), so the user has necessarily opened that origin in this
browser and accepted the certificate before pairing. The CLI deliberately does not mint pairing codes
for this reason. Chrome's exception is per-origin and the extension's fetch inherits it.

When both attempts fail, the popup modal and options page say so specifically — that the admin
UI must be opened once in this browser first — rather than reporting a generic
network error. The port stops being a literal too: the pairing UI takes it as
a field defaulting to 47831, since the operator who moved the admin port has
also moved this.

**Rejected:** a second loopback HTTP listener for the pair route. It adds an
unauthenticated plaintext port to reach a route that exists precisely because
it is unauthenticated.

### 4.3 Timeout passthrough

`ExtensionDriver.call` takes an optional timeout and forwards it to
`ExtensionServer.call`, which keeps 15s as its default. `act` derives its
timeout from the batch: the largest `wait_for.timeoutMs` in the actions plus a
fixed margin, floored at the 15s default. `BrowserDriver.act` gains no new
parameter; the value is computed from the actions the caller already sent.

An upper bound of 120s applies, and a `wait_for` above it is rejected at schema
validation rather than silently truncated. Without a ceiling a single action
pins the session queue — `registry.run` holds the session exclusively — and the
kill switch is the only way out.

The conformance suite gains a case asserting both drivers honour a `wait_for`
longer than 15s. That the suite did not already catch this is itself a finding:
it tests operation shape, not timing.

### 4.4 Epoch initialisation

`BrowserSessionRegistry` starts uninitialised rather than at epoch 0, and adopts
the first epoch an envelope carries. Core stamps `epoch` on `browser.connect`
and `browser.disconnect` today; it also stamps `browser.status`, so a status
call syncs a fresh worker without requiring a connect first. The worker side is
only `browser-dispatch.ts` passing that value through to `setEpoch`.

`setEpoch` keeps its monotonic guard, so a replayed lower epoch still cannot
widen the accepted token set. Initialisation is distinct from that guard: an
uninitialised registry accepts the first epoch it is told, and only then does
monotonicity apply.

`browser_status` stops masking the divergence. It currently reports
`pairing?.epoch() ?? live.epoch`, hiding a worker that disagrees. It returns
both — `epoch` from core and `workerEpoch` from the registry — so a stuck
worker is visible instead of silently refusing sockets.

### 4.5 Visit ledger lifecycle

The ledger gains an LRU cap of 256 sessions, and `resetVisited(sessionId)` is
called on `browser_disconnect`.

A cap rather than a session-teardown hook: the ledger is first-visit state, not
an audit record, and losing an old entry costs one extra MEDIUM tier on a
re-navigation. That is the safe direction to fail, and it bounds the map
without depending on a teardown call site that this codebase does not settle in
one place.

### 4.6 Page-content redaction, and the count that follows from it

The 2026-09-05 spec §5.5 says page content returns "through DLP redaction". It
does not. `browser_read`, `browser_snapshot`, and `browser_logs` apply
`markUntrusted` and nothing else; `redactText` is reached from exactly one place
in the codebase, and that place is approval presentation. The hardcoded
`redactionCount: 0` is therefore accurate today and meaningless — an API key
rendered in a web console comes back verbatim.

So the fix is two things, in order. Page-derived text runs through the shared
`redactText` pass before it leaves the tool, walking nested structures and
skipping `imageDataUri` because screenshot bytes are pixels rather than text.
The audit row then carries the count that pass produced.

The shared DLP pass is used rather than a browser-specific ruleset: a false
positive here corrupts what the agent sees on the page, so this content should
be judged by exactly the same classifier as everything else, and improvements to
it should reach every surface at once.

## 5. Settings shape

One new settings key, alongside the existing `browser.pairing`:

```json
{
  "loopbackClass": "SENSITIVE",
  "blockedHosts": [],
  "sensitiveHosts": []
}
```

`aevraPorts` is deliberately absent: it is derived from live config every time
the service is constructed, never stored, so a port change cannot leave a stale
allowance behind in the database.

Admin API: `GET /api/browser/policy` and `POST /api/browser/policy`, added to
the `PATHS` set in `apps/core/src/admin/routes/browser-routes.ts`. Both require
an admin session — the pairing exemption is scoped to `/api/browser/pair` and
stays that way.

Web UI: the existing `BrowserControlSettings` panel gains a loopback selector
and the two host lists. The Aevra-ports rule is shown as a fixed line, not a
control, so the UI states what cannot be changed.

## 6. Security notes

The fix for finding 1 widens what is BLOCKED, so an operator upgrading may find
a local page the agent previously reached now needs approval. That is the point,
and the settings panel is where they decide otherwise.

Finding 4's fix must not become a way to _lower_ the worker's epoch. Only an
uninitialised registry accepts an arbitrary value; once set, the monotonic guard
is unchanged. A test asserts an initialised registry rejects a lower epoch from
any source, including the new status stamp.

Finding 2's fallback to `http://` is a downgrade path, so it is attempted only
after TLS fails to connect, never after a TLS response, and the options page
reports which scheme succeeded.

## 7. Testing

- **Unit** — port set derived from config, not literals; loopback classification
  under each of the three `loopbackClass` values; Aevra ports BLOCKED even when
  `loopbackClass` is NORMAL; registry epoch initialisation versus the monotonic
  guard; timeout derivation from a batch of actions.
- **Security** — a configured non-default `AEVRA_ADMIN_PORT` leaves the admin
  origin BLOCKED; the policy settings route rejects an unauthenticated caller;
  an initialised registry refuses a lower epoch.
- **Conformance** — both drivers honour a `wait_for` longer than the default
  timeout, and both reject one above the ceiling.
- **Contract** — `browser.status` carries an epoch; `browser_status` returns
  both `epoch` and `workerEpoch`.
- **Integration** — audit row for a redacted page read carries a non-zero
  `redactionCount`.
- **UI parity** — Playwright coverage for the loopback selector.

The 85% coverage floor and `npm run test:gate` apply unchanged.

## 8. File layout

```
packages/browser/src/origin-policy.ts        config-driven ports + loopbackClass
packages/browser/src/registry.ts             epoch initialisation
packages/browser/src/extension-driver.ts     timeout passthrough
packages/browser/src/extension-server.ts     per-call timeout honoured
apps/core/src/browser/origin-policy-service.ts   new — settings + live ports
apps/core/src/admin/routes/browser-routes.ts     policy GET/POST
apps/core/src/runtime.ts                     wire policy service into deps
apps/worker/src/browser-dispatch.ts          status epoch stamp
packages/mcp-tools/src/browser-tools.ts      policy snapshot, redactionCount, status shape
packages/mcp-tools/src/browser-risk.ts       resetVisited on session end
apps/extension/src/options.ts                https first, port field, specific error
apps/web-react/src/features/settings/BrowserControlSettings.tsx   loopback selector
```

All files stay under the 350-line `.ts` / 400-line `.tsx` limits.

## 9. Build order

1. Origin policy config shape and classification rules, with unit and security
   tests. No wiring yet — the classifier is correct before anything depends on it.
2. Core policy service, admin routes, runtime wiring, `browser-tools.ts` call
   sites. Finding 1 is closed at the end of this step.
3. Extension pairing scheme, port field, error text.
4. Timeout passthrough and the conformance cases.
5. Epoch initialisation, status shape, `resetVisited`, `redactionCount`.
6. Web UI selector and Playwright coverage.
7. Documentation corrections (§10).

Steps 1-2 ship together; the rest are independently landable.

## 10. Documentation corrections

In `docs/specs/2026-09-05-aevra-browser-control-design.md`: status header to implemented;
§8 handler count to nine; §5.6 to describe query, fragment, and per-segment path
scanning; §5.7 to say sensitive screenshots are refused outright with no
approval path.

`current-work.md` is rewritten to describe this hardening work. Its browser
control checklist is stale — it lists five unstarted phases that all shipped.

## 11. Open questions

None blocking. Deferred: whether `loopbackClass` should be per-workspace rather
than global. Global is right until someone runs one Aevra across workspaces with
genuinely different local-service exposure, and nothing in the audit suggests
that yet.
