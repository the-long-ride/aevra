# Settings Native Execution + Navigation CSS Design

## Scope

Improve the current React and vanilla admin UIs together, keep the top navigation in one horizontal row, eliminate intermittent page resets during tab switching, and add an explicit Native host execution option.

## Shared UI behavior

- `apps/web/styles/*` remains the canonical styling source. React continues importing the vanilla CSS instead of creating divergent React-only rules.
- The top admin navigation stays `flex-wrap: nowrap` and horizontally scrollable on narrow viewports.
- Form controls use consistent compact heights, clearer dark select styling, stronger focus visibility, and denser panel spacing.
- Execution settings expose `Auto`, `Docker`, `Podman`, and `Native host` in both UIs.
- Selecting Native host shows a visible warning that commands run directly on the local computer without container isolation.

## Navigation model

The URL hash is the single source of truth for page selection.

- A navigation click updates `location.hash`.
- `hashchange` performs the render/state transition.
- Back/forward therefore uses the same path as clicks.
- Invalid or empty hashes resolve to Dashboard only.
- React must not combine `history.replaceState` with a manual page-state write.
- Vanilla must not combine `history.replaceState` with a direct `activate()` call for normal navigation.

## Native host execution

`execution.settings.sandboxBackend` may be `auto | docker | podman | native`.

`native` is a default execution target, not a new sandbox implementation:

- If a command/shell request omits `executionMode` and the saved backend is `native`, resolve the request to `host` before risk calculation, permission matching, and approval creation.
- Explicit `executionMode: sandbox` or `executionMode: host` continues to win over the saved default.
- Host execution keeps the existing host-specific permission matcher and host risk floor behavior.
- `OperationService` maps a saved `native` backend to `auto` when a request explicitly executes in sandbox mode so the worker never receives an unsupported sandbox backend value.
- `Auto` never silently falls back to host/native.

## Security invariants

Native host does not bypass approval, workspace capability roots, command classification, command matchers, audit, or CRITICAL one-time approval rules. It only changes the default execution mode when the caller did not explicitly choose one.

## Test requirements

- React navigation regression test covers repeated tab switching and hash-driven navigation.
- Vanilla navigation source/behavior contract proves click navigation goes through the hash route.
- Command tool tests prove saved `native` resolves an unspecified command to host before matcher/risk handling, while explicit sandbox stays sandbox.
- React/vanilla settings parity tests require the Native host option and warning.
- Shared CSS contract requires horizontal non-wrapping navigation and the refreshed dark form/select rules.
