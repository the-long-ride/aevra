# Background desktop automation design

Date: 2026-09-18
Status: Proposed for human review; implementation not authorized by this document.
Related: [existing desktop design](2026-09-07-aevra-desktop-control-design.md)
Plan: [implementation plan](../plans/2026-09-18-background-desktop-automation.md)

## Goal and acceptance boundary

Allow a connector to operate supported controls in a specified Windows application while the human uses another foreground application. Start with UI Automation (UIA) patterns and validate against QuotaShift. Aevra must not move the cursor, inject input, activate a window, restore a minimized window, or use the clipboard on this path.

This is an input-isolation contract, not a guarantee that arbitrary application code cannot activate a window. Invoking a control can open a dialog or activate another application. Record observed focus changes, stop further background actions for that ownership lease, and require a fresh inspection. Do not restore focus automatically. Strict isolation of arbitrary applications requires a separate OS environment.

Windows first. Existing foreground tools remain available with their current semantics and approvals. No QuotaShift changes, API bridge, VM provisioning, generic shortcuts, background coordinate clicks, drag/drop, or background scroll in this increment.

## Current implementation and implications

- `helper/src/input.rs` uses SendInput and SetCursorPos.
- `helper/src/act.rs` resolves click handles but checks the described window is foreground. Text/key operations use focused desktop input.
- `apps/worker/src/desktop-dispatch.ts` gates input against focusedWindow().
- `packages/desktop/src/windows-driver.ts` has one ref map, cleared by describe; public refs use helper generation and node index. Repeated descriptions within a helper lifetime can reuse public ref strings.
- `helper/src/windows.rs` owns one UIA handle table and one described window.
- `packages/desktop/src/registry.ts` serializes individual operations globally. That does not reserve a window for a multi-call workflow.
- `packages/protocol/src/worker.ts` already carries sessionId and workspaceId in the worker envelope; use verified envelope identity, never model-supplied ownership.
- `packages/mcp-tools/src/desktop-act.ts` integrates capability authorization, action approval and audit, and protects text/key payloads from persisted approvals.

These are source observations, not live QuotaShift compatibility results.

## Alternatives and decision

1. UIA patterns: chosen for general desktop support without application changes. Coverage is provider-dependent.
2. App-specific API/bridge: follow-up only for important QuotaShift controls that lack usable UIA patterns; separate specification.
3. Dedicated VM: option when arbitrary clicks/keys and strict human-input isolation are required; outside this implementation.

Retain the global helper queue in v1. Add exclusive, expiring ownership per target window across calls. Per-window parallel helper execution is deferred: it adds COM and lifecycle complexity without being necessary for human/agent coexistence.

## Public contract

Add an optional `backgroundActions: boolean` to desktop capabilities. Missing means false. New helpers report true only on supported Windows hosts. Preserve all existing capability fields.

Extend desktop_describe with optional `mode: "foreground" | "background"`, default foreground. Background mode requires an explicit windowId. It authorizes desktop.control before reserving a target and returns:

```ts
type BackgroundAction = 'invoke' | 'setValue' | 'select' | 'toggle';
interface BackgroundSnapshot {
  window: DesktopWindowIdentity;
  snapshotId: string;
  windowLeaseId: string;
  leaseExpiresAt: string; // UTC ISO timestamp
  nodes: Array<
    DesktopNode & {
      supportedActions: BackgroundAction[];
      readOnly?: boolean;
      toggleState?: 'off' | 'on' | 'indeterminate';
    }
  >;
  truncated: boolean;
}
```

Existing DesktopDescribeResult gains optional snapshot/lease fields; background mode requires them at runtime. Background node refs are opaque random IDs and are never reused. Capability metadata is descriptive; action-time checks remain mandatory. Disabled controls advertise no executable actions. Read-only fields do not advertise setValue. Do not expose password values; refuse background setValue on password controls in v1.

New tools, each with strict schemas and no additional properties:

| Tool                   | Required arguments                                   | Meaning                                                            | Risk   |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| desktop_invoke         | windowId, snapshotId, windowLeaseId, ref             | InvokePattern.Invoke once                                          | MEDIUM |
| desktop_set_value      | same, value:string (maximum 65536 UTF-16 code units) | ValuePattern.SetValue; replace complete value                      | HIGH   |
| desktop_select         | common arguments                                     | SelectionItemPattern.Select; single item, no additive multi-select | MEDIUM |
| desktop_toggle         | common arguments                                     | TogglePattern.Toggle exactly once                                  | MEDIUM |
| desktop_release_window | windowId, windowLeaseId                              | Release caller-owned lease and snapshots                           | LOW    |

SetValue is not typing: controls needing keyboard events are unsupported. Toggle is intentionally one transition, including tri-state controls; return observable resulting state when available. Do not retry invoke/toggle automatically.

Successful action result:

```ts
interface BackgroundActionResult {
  ok: true;
  outcome: 'completed';
  window: DesktopWindowIdentity;
  snapshotInvalidated: true;
  requiresDescribe: true;
  focusChanged: boolean;
  postActionStateUnknown?: boolean;
  toggleState?: 'off' | 'on' | 'indeterminate';
}
```

Completed means the provider call returned successfully, not that an asynchronous business workflow finished. After every dispatched mutation, invalidate the snapshot and require describe before the next action. A successful post-read must not expose the field value. A failed post-read preserves completed outcome and marks state unknown.

## Trusted ownership and reference lifecycle

Owner identity is `{sessionId, workspaceId}` from the verified worker envelope. Session continuity across OAuth reconnects does not transfer refs or leases: a new session inspects again.

Worker-side `BackgroundDesktopState` owns window leases and public-ref mappings. Helper owns COM elements in separate background snapshot tables; legacy foreground describe must not clear these tables.

- Acquire a lease atomically during background describe after target authorization. Scope key is HWND plus PID plus process creation time, not title or HWND alone.
- Lease idle TTL: 60 seconds, renewed only by successful owner describe or confirmed action. Max 8 leases per owner, 32 host-wide; max 5000 nodes per snapshot. Reject exhaustion instead of evicting another active owner.
- One current snapshot per owned window; re-describe invalidates the owner's previous snapshot for that window.
- Snapshot record binds owner, lease ID, helper epoch, window identity, snapshot ID and native handle. Missing/wrong/expired refs fail closed.
- Busy window: return DESKTOP_WINDOW_BUSY, with retryAfterMs but no other connector identity.
- Release is idempotent for the original owner, never releases another owner's active lease. Unknown IDs return a non-releasing stale result.
- Disconnect, helper death/restart and worker shutdown invalidate all background leases/snapshots and queued work through a registry epoch.
- Expiration performs lazy cleanup on every operation and schedules native snapshot release; cleanup happens on the existing helper queue.
- A session's loss of authority blocks execution at existing authorization boundaries. No persistence of leases or snapshots.
- Legacy foreground mutation is rejected when its resolved target has an active background lease. Raw type/key/scroll still cannot become safe background actions.
- Reads do not acquire ownership except explicit background describe. The global queue makes the validation and invocation sequence exclusive relative to other Aevra operations.

Ownership does not lock out human input or mutations from other processes. This remains best-effort automation of a live UI, with fresh inspection after mutations. Callers should not automate the same form the human is editing.

## Execution path and security

```text
MCP tool -> capability + action approval -> signed Worker envelope
 -> global queue + epoch check -> owner/ref/lease check
 -> live target identity + window policy
 -> helper identity/integrity/element checks -> UIA pattern
 -> invalidate snapshot -> outcome, redacted audit
```

Add a separate worker kind `desktop.backgroundAct`, not a fallback branch in desktop.act. Pass verified owner context from dispatcher to desktop dispatch. A model cannot override owner, process identity, policy, or epoch.

Gate background actions against the actual target, including refreshed process/path/title, never foregroundWindow. Unknown identity is denied even if legacy unattributedInput permits input. Native action verifies HWND/PID/process creation time and element ancestry to the target UIA root immediately before dispatch. WebView child providers may have a different PID; verify root ancestry rather than requiring every element PID equal the host PID. Identity changes are stale-target errors.

Native checks refuse secure/non-default desktops, elevated targets, helper elevation/UIAccess, unreadable integrity information, and a higher target integrity level. Never request UIAccess or elevate. Add required Windows crate feature flags for token/desktop inspection.

Correction to the existing input.rs rationale: UIA does not universally bypass Windows privilege restrictions. Its access depends on integrity/UIAccess. Preserve explicit application restrictions rather than relying on that blanket comment.

Map only InvokePattern, ValuePattern, SelectionItemPattern and TogglePattern. No SetFocus, SendInput, SetCursorPos, PostMessage key synthesis, clipboard fallback, window activation or coordinate fallback.

Approval resumes recheck current authority, ownership, target and snapshot. An expired snapshot returns stale and needs fresh describe/approval; do not bind an approval to a different target. For setValue, persist only valueLength and an opaque per-request nonce. Use that nonce for exact approval binding, not a hash of the secret value, and never reuse it for another payload. Retain plaintext only in the existing bounded in-memory execution closure.

Audit includes tool, target identity (existing path redaction), outcome, gate rule and valueLength where needed. Never persist raw value, returned field content, native provider error text or secret-bearing control labels. UI tree content stays marked untrusted.

## Failure and cancellation semantics

Add structured helper errors `{code,message,details?}` while accepting legacy string errors in HelperProcess. Keep error details allowlisted.

- DESKTOP_BACKGROUND_UNSUPPORTED: host/helper cannot offer this backend.
- DESKTOP_PATTERN_UNSUPPORTED / DESKTOP_ELEMENT_DISABLED / DESKTOP_VALUE_READ_ONLY: no dispatch.
- DESKTOP_REF_STALE / DESKTOP_TARGET_CHANGED / DESKTOP_WINDOW_BUSY / DESKTOP_LEASE_EXPIRED: no dispatch.
- DESKTOP_INPUT_REFUSED: policy, integrity, secure desktop or protected-field rejection.
- DESKTOP_OUTCOME_UNKNOWN: helper timeout/death after mutation request was sent; mutation may have occurred. No replay.
- DESKTOP_FOCUS_CHANGED: subsequent action on a suspended lease refused until a fresh background describe.

Keep the existing 10-second helper deadline. Kill a hung helper, invalidate epoch and refs, reject pending calls and discard queued old-epoch work. Killing the helper cannot undo a provider operation already delivered. Distinguish pre-dispatch rejection from unknown outcome.

Before/after foreground sampling reports observed changes only; transient focus changes may escape sampling and unrelated human focus changes may produce conservative suspension. This is not a prevention guarantee.

## Verification and release criteria

1. Native synthetic fixture exposes a button, editable/read-only/password fields, list item, tri-state toggle, unsupported control, disappearing element, modal/hung-provider path.
2. While a foreground sentinel receives human/synthetic fixture text, invoke and setValue on the covered background fixture. Assert sentinel text is unchanged by Aevra, target state changes, cursor is unchanged by Aevra, and no forbidden input API is called.
3. Two sessions: independent windows succeed sequentially; same window returns busy; stolen refs fail; fresh describe/restart never rebind old refs; legacy foreground writes cannot bypass ownership.
4. Policy and privilege tests: target denied while foreground allowed, target allowed while foreground unrelated, HWND reuse, changed root ancestry, elevation, secure desktop, malformed protocol, secret audit/approval leakage.
5. Timeout after provider dispatch is unknown, never retried. Disconnect remains responsive; queued old-epoch calls cannot run on a replacement helper.
6. QuotaShift read-only inspection first. Record app/OS version, controls, patterns, covered-window behavior, minimized behavior separately, and any focus side effects. Execute only reversible navigation/search interactions with synthetic text; no account switch, credential entry, deletion or production settings changes. Unsupported controls are documented, not bridged in this project.
7. Run TypeScript and Rust regressions, full repository gate, and dedicated native fixture tests. Linux fake-driver passes do not establish Windows compatibility.

Release gate: synthetic native coexistence passes and QuotaShift's explicitly listed supported interactions pass. If QuotaShift exposes no useful patterns, report that evidence and propose a separate bridge design; do not claim this goal met.

## Sources

- [Microsoft UI Automation commands](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/ui-automation): UIA-pattern actions versus input injection.
- [UI Automation security](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-security-overview): protected UI and UIAccess.
- [InvokePattern provider behavior](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.invokepattern.invoke?view=windowsdesktop-10.0): provider-dependent blocking.

## Review state

Design and plan created at the user's request. No implementation, live QuotaShift mutation, commit or release performed. Human review is the next step.
