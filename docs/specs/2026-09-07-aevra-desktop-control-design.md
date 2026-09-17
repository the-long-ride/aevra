# Aevra Desktop Control — Design

**Date:** 2026-09-07
**Status:** Approved design, ready for implementation planning
**Target version:** 1.1.0
**Supersedes nothing. Extends:** `docs/superpowers/specs/2026-09-05-aevra-browser-control-design.md`

---

## 1. Purpose

Let an AI operating through Aevra use the host desktop — see what is on screen and
drive the mouse and keyboard — on Windows, macOS, and Linux, under policy that
Aevra enforces.

Three properties drive every decision below, in this order:

1. **Safe.** The agent holds a real mouse on a real session. Containment is the
   design, not a feature of it.
2. **Token-efficient.** An accessibility-tree-first loop costs roughly 2k tokens
   for a 30-step task where a screenshot-per-step loop costs 30–60k.
3. **Fast and smooth.** No per-action round trip to Core; no fight with the human
   for the cursor.

### Explicitly out of scope

- Mobile devices (Android/iOS). Different transport, pairing, and capability
  model; its own spec if it is ever wanted.
- Interactive TTY control (driving a REPL, `ssh`, `vim`). Aevra already has
  `shell_run` and the `process_*` tools for non-interactive command execution.
- Running as SYSTEM/root, or any automatic privilege elevation. This remains out
  of scope per `docs/ROADMAP.md` and is reinforced here: the Windows backend
  deliberately cannot inject into elevated windows.
- Drag-and-drop, clipboard access, OCR fallback, video capture, window
  move/resize, multi-monitor targeting beyond window identity. Each is additive
  and none is required for the core loop.

### Roadmap correction

`docs/ROADMAP.md` lists "Browser extension or DOM automation" under _Out of
scope_. That was overtaken by the browser-control subsystem shipped in 1.0.5.
The ROADMAP must be updated as part of this work; the entry is stale, not a
constraint.

---

## 2. Threat model

A desktop has no addressable identity. Browser control could refuse `chrome://`
because a URL names a thing. "The window at (400, 300)" names nothing, and an
agent with a mouse can:

- click Aevra's own approval dialog and authorize itself;
- open a terminal and run anything the user could run;
- read a password manager, an email client, or a signed-in session;
- act on an installer, a wipe confirmation, or a Send button.

The response is to give the desktop an identity — per window, and where possible
per element — and to gate on it. Every other control in this document depends on
that identity being available.

### Identity suppression is a security signal

Operating systems suppress window and element introspection precisely where
things are sensitive:

| OS            | Suppressed case                                           |
| ------------- | --------------------------------------------------------- |
| Windows       | UAC elevation prompts render on a separate secure desktop |
| macOS         | Secure input mode engages on password fields              |
| Linux         | polkit dialogs, lock screen                               |
| Linux/Wayland | All global introspection, by design                       |

Therefore "unattributable" correlates with "sensitive." A design that treats
unattributable as permitted grants the most access exactly where the OS is
signalling the most caution. That inversion is the single most important thing
this spec exists to prevent.

---

## 3. Containment model

Three mechanisms, composed.

### 3.1 Window and element identity (the primitive)

Before any action, the driver resolves the target's identity: process name,
executable path, window title, and — when acting on a `ref` — the element's
accessibility role and name.

### 3.2 Allowlist by default, denylist available (policy)

Per workspace, policy is one of:

- **allowlist** (default): act only in explicitly permitted applications;
- **denylist**: act anywhere except named applications. The shipped default
  denylist covers Aevra's own UI, terminal emulators, password managers and
  keychains, and system elevation dialogs.

### 3.3 Approval for the irreversible set (backstop)

A small set of actions routes through Aevra's existing approval flow. Approval
alone is not a control — an agent with a mouse can click the approval dialog —
so it is only meaningful _because_ 3.1 refuses to act on Aevra's own windows.

### 3.4 The failure rule

When identity is unavailable, failure is split by direction:

| Identity            | Capture (screenshot) | Input (click / type / key / scroll) |
| ------------------- | -------------------- | ----------------------------------- |
| Attributed, allowed | permitted            | permitted                           |
| Attributed, denied  | permitted            | refused                             |
| **Unattributable**  | **permitted**        | **refused**                         |

Rationale: the failure modes are not symmetric. A wrong screenshot is
recoverable and reviewable. A wrong click ran an installer, deleted a file, or
sent an email. Reading is also what keeps the feature useful where input is
impossible — on Wayland without portals the agent can still see the screen and
tell the user what to do.

**Escape hatch:** a per-workspace setting `unattributedInput: "allow"` flips
input to fail-open. Default `"deny"`. When enabled it is reported prominently by
`aevra status` and by `desktop_status`. Flat fail-open therefore remains
available, but must be chosen rather than inherited.

### 3.5 Composition property

The macOS secure-input case needs no special handling: password fields suppress
attribution, unattributable refuses input, so the agent structurally cannot type
into a secure field. This falls out of the rule rather than being coded against.

---

## 4. Perception: accessibility tree first, pixels on demand

`desktop_describe` serializes the focused window's accessibility tree with
`ref_N` handles. `desktop_capture` returns a screenshot only when asked.

Beyond token cost, the tree provides **element identity**, which upgrades
containment from "you may act in Chrome" to "you clicked the button named
_Approve request_." Consequences:

- Actions are `click(ref)`, not `click(x, y)`. Coordinates cannot go stale
  between observation and action — the largest source of misfires in
  pixel-driven control.
- The audit log records what was clicked, so human review is possible.
- Policy can match on element role and name, not only window title.

Coordinate clicking survives as `desktop_click{ coordinate }` for canvas, game,
and remote-desktop surfaces. It inherits §3.4: an unattributable surface permits
capture and refuses input.

A `ref` whose element has died returns `stale_ref`. It never falls back to
clicking whatever now occupies those pixels.

---

## 5. Architecture

### 5.1 Components

| Unit                   | Home                               | Responsibility                                                                   |
| ---------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| `desktop_*` MCP tools  | `packages/protocol`                | Tool surface and result types                                                    |
| `DesktopDriver`        | `packages/desktop`                 | Interface: `describe`, `capture`, `click`, `type`, `key`, `scroll`, `windows`    |
| `DesktopRegistry`      | `packages/desktop`                 | Session lifetime plus a serial operation queue                                   |
| `HelperProcess`        | `packages/desktop`                 | Spawns the helper binary, line-delimited JSON-RPC over stdio, deadlines, restart |
| `WindowGate`           | `packages/security`                | Attribute a target, then allow / deny / unattributable                           |
| `aevra-desktop` helper | new top-level `helper/` Rust crate | Per-OS backends behind one trait                                                 |

Helper backends: Windows UIA + `SendInput`; macOS AX + `CGEvent`; Linux AT-SPI +
XTest. The Linux `uinput` and `xdg-desktop-portal` paths are deferred, not
designed here.

`DesktopRegistry` mirrors `BrowserRegistry`, including the rule that
`connect`, `disconnect`, and `status` stay **outside** the serial queue so the
kill switch reaches a wedged session.

### 5.2 Why a helper binary rather than a native Node addon

Decisive reason: macOS TCC. Accessibility and Screen Recording grants are keyed
to code-signing identity for a signed and notarized binary, and to path plus
content hash for an unsigned one. A native addon's grantable unit would be the
user's `node` executable — which means granting blanket Accessibility to `node`,
and re-granting per Node version. A signed standalone binary is therefore forced
by the platform.

Supporting reasons: the accessibility APIs are COM, Objective-C, and D-Bus, all
of which want a real type system rather than FFI glue; a crash in UIA COM code
is contained to a child process instead of taking down the Worker; and no native
toolchain is needed on user machines.

Shelling out to per-OS CLI tools (`nircmd`, `cliclick`, `xdotool`, `ydotool`)
was rejected on capability, not taste: none exposes an accessibility tree, so
tree-first perception is impossible with them.

**Accepted cost:** an Apple Developer ID with notarization in CI (~$99/yr) and
Windows Authenticode signing. Without signing, macOS re-prompts for Accessibility
on every Aevra update and Windows shows SmartScreen warnings.

### 5.3 Authorization boundary

Aevra's model is _Core authorizes, Worker executes_. This feature bends it,
deliberately and explicitly: whether a click is permitted depends on which window
has focus, and that fact does not exist when Core signs the envelope.

**Resolution — envelope carries policy:**

- **Core issues policy** inside the signed operation envelope: the allowlist or
  denylist, the approval set, and the `unattributedInput` flag.
- **Worker evaluates that policy** against the identity it observes at the
  instant of the action.
- **The observed identity and the gate verdict are written to the audit log**, so
  Core can see after the fact what Worker judged.

The alternative — a round trip to Core carrying observed identity before every
click — is more faithful to the existing model and costs a Core round trip per
action, which directly defeats the latency goal. Rejected for that reason, with
the audit log as compensating control.

### 5.4 Action flow

1. Model calls `desktop_click{ ref }`.
2. Core authorizes: capability enabled for this workspace, tool permitted,
   envelope signed with policy embedded.
3. Worker enqueues on `DesktopRegistry.run()`. Operations are serialized; two
   clicks interleaving on one cursor is meaningless.
4. Driver resolves current focused-window identity and the element behind `ref`.
5. `WindowGate` judges: allowed, denied, or unattributable.
6. Input plus unattributable is refused unless `unattributedInput: "allow"`.
   Capture is never refused on this path.
7. Actions in the irreversible set route through the approval flow.
8. Helper acts on the element handle, not on coordinates.
9. Audit log records window identity, element role and name, verdict, and the
   policy rule that decided it.

---

## 6. Tool surface

Ten tools, named and shaped to mirror `browser_*` so the two subsystems teach
each other:

`desktop_status` · `desktop_connect` · `desktop_disconnect` · `desktop_windows` ·
`desktop_describe` · `desktop_capture` · `desktop_click` · `desktop_type` ·
`desktop_key` · `desktop_scroll`

### 6.1 Token budget — the three defaults that decide it

**Scope.** `desktop_describe` covers the focused window, never the whole
desktop. Defaults: `filter: 'interactive'`, depth cap 15, `max_chars` 50000 with
truncation noted in the result. `desktop_windows` provides the cheap
one-line-per-window overview when the model needs to look wider.

**Delta on every action.** Each action result reports whether focus changed,
whether a new window appeared, and whether the target's subtree changed. A
typical result is a few dozen tokens. This removes the naive
click-then-re-describe loop, which costs 1–3k tokens per step.

Measured intent for a 30-step task: **~2k tokens (delta loop) versus ~30–60k
(screenshot-per-step)**.

**Screenshots are never implicit.** `desktop_capture` reports
`devicePixelRatio` and pins logical coordinates so that screenshot pixels and
click coordinates share one space. This is the coordinate-space defect fixed in
browser vision mode in 1.0.5 and must not be reintroduced.

---

## 7. Capability detection and platform support

At connect, the helper reports four independent booleans for the host:
`capture`, `tree`, `attribution`, `input`. This extends the pattern already in
`apps/core/src/system/capability-detector.ts` rather than introducing a second
mechanism. `desktop_status` surfaces them so the model learns "no input here"
once, instead of discovering it through repeated failures.

| Platform        | capture                     | tree                    | attribution | input                                    |
| --------------- | --------------------------- | ----------------------- | ----------- | ---------------------------------------- |
| Windows 10/11   | yes                         | UIA                     | yes         | yes — never into elevated windows (UIPI) |
| macOS 13+       | yes (TCC: Screen Recording) | AX (TCC: Accessibility) | yes         | yes (TCC: Accessibility)                 |
| Linux / X11     | yes                         | AT-SPI                  | yes         | yes                                      |
| Linux / Wayland | portal only                 | AT-SPI, partial         | no          | **no — read-only**                       |

This table ships in user documentation verbatim. Linux is the weak leg in both
directions — Wayland for transport, AT-SPI for perception — and the docs must say
so rather than implying parity. Shipping tiers: Windows and macOS first-class,
Linux/X11 second, Linux/Wayland read-only.

---

## 8. Failure handling

**Helper death is normal, not exceptional.** UIA hands out dead COM handles
routinely. Policy:

- the in-flight operation fails with `driver_died`;
- **all refs are invalidated** — they point into a process that no longer
  exists, and silently reusing them is how an agent clicks the wrong thing;
- the helper restarts on the next call;
- session state does not silently carry across the restart.

**Every helper RPC is deadline-bounded.** A hung
`AXUIElementCopyAttributeValue` against a frozen application is common and must
not wedge the serial queue. On deadline the watchdog kills the helper, which
enters the path above. The kill switch remains outside the queue.

**Human takeover aborts the operation.** If the user moves the mouse or types
while an operation is in flight, that operation aborts. Two actors fighting for
one cursor produces clicks that landed somewhere nobody chose; this is the worst
available failure mode and it is cheap to detect.

---

## 9. Logging and data handling

- Every input action logs: window identity, element role and name, gate verdict,
  and the deciding policy rule.
- **Typed text is never logged.** Length and target element only. `desktop_type`
  is the tool most likely to carry a credential.
- **Screenshots are never persisted to the audit log.** They are returned to the
  caller and dropped. A retained screenshot store is a plaintext archive of
  everything that was on screen, including background windows.
- **Accessibility text passes through `redactText` before reaching the model** —
  the same DLP pass used by `packages/security/src/browser-url-policy.ts`.
  Accessible names and adjacent labels can carry secrets even though UIA and AX
  do not expose password field values.

---

## 10. Testing strategy

**1. Conformance suite and `FakeDriver`.** One table-driven suite run against
every `DesktopDriver` implementation, following the browser driver conformance
pattern. `FakeDriver` needs no OS, so registry serialization, ref lifetime, delta
computation, and protocol shapes are covered on every push on every runner.

**2. `WindowGate` — exhaustive, not sampled.** It is a pure function and the
security core, so the full cross-product is asserted: {allowed, denied,
unattributable} × {capture, input} × {`unattributedInput` allow, deny} ×
{allowlist, denylist}. Named regression tests cover the three inversion cases:
unattributable-plus-input refuses; a macOS secure-input field refuses; a Windows
elevated window refuses.

**3. Helper protocol against a fake helper.** A small Node script speaking the
JSON-RPC framing exercises partial lines, malformed output, deadline expiry,
mid-call death, and restart — with no OS involvement. The mandatory case is
**refs invalidated across a helper restart**.

**4. Rust helper unit tests.** `cargo test` per backend on a matching runner.

**5. End-to-end.** Honest coverage, stated as it is:

- **Linux/X11 under Xvfb** — fully automatable, runs every push.
- **Windows** — `windows-latest` runners have an interactive session, so
  `SendInput` and UIA against a launched Notepad are expected to work in CI. This
  is unproven and must not be claimed as covered until it runs green.
- **macOS** — **not CI-automatable.** TCC grants require a human in System
  Settings and there is no supported pre-authorization for runners. macOS gets a
  written manual smoke checklist executed at release.

### 10.1 Repo-fit constraints

- The 85% coverage floor is measured by JS tooling that cannot see the Rust
  crate. The helper needs its own gate — `cargo llvm-cov` with its own
  threshold — or must be explicitly excluded and documented as excluded.
  Silently uncovered native code in a coverage-gated repo is worse than
  honestly-excluded native code.
- TypeScript strict, `module: NodeNext`, root `tsconfig` `types: []` with no DOM
  lib. LOC limits: 350 for `.ts`, 400 for `.tsx`.
- **No secret-shaped literals in fixtures, including dummy ones.** Use
  `randomBytes(32).toString('base64url')` or low-entropy repeats such as
  `'a'.repeat(64)`. This applies with particular force to the DLP tests, whose
  natural implementation is exactly the prohibited thing.

---

## 11. Open items for the implementation plan

These are known and deliberately unresolved here; the plan must settle them.

1. **Helper distribution.** The extension installer shipped in 1.0.5
   (`apps/cli/src/commands/extension-archive.ts`) already downloads a
   version-matched artifact, verifies checksums, and validates every path. The
   helper fetcher is the same shape with a different payload. Whether to reuse
   that code directly or generalize it is a plan-level decision.
2. **Signing pipeline.** Apple Developer ID enrollment, notarization in CI, and
   Windows Authenticode. This has a lead time measured in days and gates the
   macOS experience, so it should start before the code needs it.
3. **Default denylist contents.** The shipped list of terminal emulators,
   password managers, and system dialogs must be enumerated per OS.
4. **The irreversible-action set** routed through approval must be enumerated.
5. **ROADMAP update**, removing the stale browser-automation exclusion and adding
   desktop control.
