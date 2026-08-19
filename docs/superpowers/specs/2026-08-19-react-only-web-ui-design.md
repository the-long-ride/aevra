# React-only Web UI Cutover and OpenCode-derived Design System

Date: 2026-08-19
Status: Approved design, awaiting written-spec review
Target branch: `main`

## Goals

This change completes the migration to a single React + TypeScript admin UI and applies a new shared visual system derived from the supplied OpenCode design analysis.

The implementation must:

1. Fix the navigation race where switching away from Dashboard can be undone about one second later.
2. Remove the Version tile from Dashboard Runtime Overview.
3. Remove the vanilla web UI completely.
4. Remove `aevra start --ui-react`.
5. Make `aevra start --ui` launch the React UI at `/`.
6. Remove `/react/` as a supported admin destination.
7. Make `apps/web-react/design.md` the canonical Aevra web-UI design document.
8. Implement persistent light/dark theme switching with the toggle directly left of Requests.
9. Make the UI responsive for desktop, tablet, and mobile while keeping page tabs horizontal.
10. Preserve existing backend security, approvals, permissions, onboarding, and admin APIs.
11. Preserve repository gates: Prettier, LOC limits, dead-code checks, semantic typecheck, tests, and 85% coverage thresholds.

## Non-goals

- No backend API redesign.
- No change to MCP authentication or Cloudflare architecture.
- No new UI framework beyond the existing React application.
- No bundling or redistribution of Berkeley Mono.
- No mobile hamburger navigation for admin page tabs.
- No compatibility vanilla UI after the cutover.

## Root Cause: Dashboard Navigation Race

Current navigation stores the active page in React state but programmatic navigation only writes `window.location.hash`, relying on a queued `hashchange` event to synchronize state.

Dashboard is also an actively polling page. A user can therefore:

1. navigate to Dashboard;
2. immediately click another page;
3. still have pending Dashboard work or queued navigation work in flight;
4. observe Dashboard become active again after the later event/update resolves.

The fix is to stop using programmatic `hashchange` as the page-state transport.

### New routing model

- `navigate(next)` synchronously updates the React page state.
- It then writes `#/next` using `history.pushState`.
- Browser Back/Forward uses `popstate` to derive the active page from `location.hash`.
- Invalid or empty hashes resolve to Dashboard only when parsing current URL state.
- Dashboard requests remain abortable and may update Dashboard resource state only while the Dashboard component is mounted.
- No Dashboard load/poll completion may call navigation or derive the active page.

### Required regression

A test must deliberately delay Dashboard loading/polling, switch to Dashboard, immediately switch to another tab, advance past the delayed Dashboard completion, and assert that the second tab remains active.

Back and Forward must also be covered.

## React-only Cutover

### Source tree

`apps/web` is removed after parity-critical behavior/tests have been moved to React tests or shared contracts.

`apps/web-react` remains the single UI source tree.

The React app should retain its feature-oriented structure:

```text
apps/web-react/
  design.md
  index.html
  vite.config.ts
  src/
    app/
    components/
    features/
    hooks/
    services/
    styles/
    test/
```

### Build output

Vite changes from:

```text
base: /react/
outDir: dist/apps/web/react
```

to:

```text
base: /
outDir: dist/apps/web
```

The old vanilla static-copy step is removed. User manual assets, if still served under the admin static root, must be copied without overwriting the React build.

### Static server

The admin static server supports `/` as the only application entry.

- `/` resolves to `dist/apps/web/index.html`.
- React asset paths resolve beneath `dist/apps/web`.
- `/react` and `/react/` are not alternate application roots.
- Existing path-traversal protection remains.

### Bootstrap redirect

Authenticated bootstrap accepts `/` as the UI destination.

The `/react/` compatibility destination is removed. Invalid destinations remain rejected before token consumption.

## CLI Contract

Before:

```text
aevra start --ui       -> vanilla /
aevra start --ui-react -> React /react/
```

After:

```text
aevra start --ui       -> React /
```

`--ui-react` is removed from parsing, help text, completion output, tests, docs, and runtime types.

No alias is retained.

The standalone `aevra ui` command continues to open the single React admin UI at `/`.

## Dashboard Changes

Runtime Overview retains operational information but removes the Version tile.

Version remains available in the application header/runtime health/status presentation.

Existing Dashboard behavior remains:

- Onboarding contains Remote Access first.
- Incomplete Onboarding is near the top.
- Completed Onboarding moves to the bottom.
- Dashboard sections are collapsible.
- Collapse state survives polling.
- Active form work is not destroyed by polling.
- Connector actions and activity tables remain available.

## Canonical Visual System

`apps/web-react/design.md` is the canonical UI design contract.

It is based on the supplied OpenCode design analysis, adapting the source vocabulary to Aevra's product UI:

- monospaced typography everywhere;
- warm cream light canvas and near-black ink;
- 4px interactive radius;
- square/flat structural containers;
- 1px hairline separation;
- no shadows;
- no gradients;
- restrained semantic colors;
- ASCII/text-forward affordances;
- compact application spacing rather than marketing-page spacing.

Berkeley Mono is not bundled. The preferred stack begins with JetBrains Mono and IBM Plex Mono, followed by system monospace fallbacks.

## Theme System

### State

Theme values:

```text
light
dark
```

The selected theme is stored in `localStorage` under a versioned Aevra-specific key.

When no stored value exists, initialize from `prefers-color-scheme`.

The app root sets a stable attribute such as:

```html
<html data-theme="light">
<html data-theme="dark">
```

CSS variables define the palette per theme.

### Toggle

The theme toggle sits in the header immediately left of Requests.

It uses text/ASCII-style presentation rather than a decorative icon. The control exposes an accessible label describing the action, e.g. "Switch to light mode".

Theme toggling must not navigate, refresh the active page, reopen drawers, or reset page state.

### Light palette

The light theme follows the supplied OpenCode source closely:

```text
canvas #fdfcfc
ink #201d1d
surface-soft #f8f7f7
surface-card #f1eeee
hairline rgba(15,0,0,.12)
accent #007aff
warning #ff9f0a
danger #ff3b30
success #30d158
```

### Dark palette

Dark mode is an Aevra-specific neutral inversion because the source document does not define a full dark application theme. It keeps the same flat geometry and semantic colors.

## Responsive Layout

### Global rules

- Page tabs always remain horizontal.
- Tabs use `flex-wrap: nowrap` and horizontal scrolling.
- Theme and Requests controls remain reachable at every supported width.
- No horizontal page overflow from ordinary forms/panels.
- Long code/path/endpoint values wrap or use a dedicated scroll container.
- Tables remain readable through stacked mobile rows or explicit horizontal scrolling.
- Drawers/modals fit within viewport width/height.

### Desktop: >= 1024px

- Full runtime health cluster.
- Multi-column forms and dashboard grids where useful.
- Bounded readable page width.

### Tablet: 641px-1023px

- Horizontal nav remains.
- Lower-priority runtime health text may condense/hide.
- Two-column form layouts collapse when necessary.
- Request and theme controls remain visible.

### Mobile: <= 640px

- Single-column panels/forms.
- 12px page padding.
- Header identity may compact.
- Horizontal tab strip scrolls.
- Controls target approximately 40px minimum height.
- Requests drawer becomes viewport-width.
- Tables and code never clip offscreen.

## CSS Architecture

With vanilla removed, React owns all UI CSS.

Recommended structure:

```text
src/styles/
  tokens.css
  shell.css
  components.css
  dashboard.css
  admin.css
  requests.css
  responsive.css
```

No React stylesheet may import removed `apps/web/styles/*` files.

Theme variables live in `tokens.css`.

Responsive rules should be centralized enough to make breakpoint behavior auditable rather than scattered through every feature.

All CSS remains under the repository 500-line-per-file limit.

## Tests

### Routing

- navigation is immediate without waiting for `hashchange`;
- delayed Dashboard work cannot restore Dashboard;
- Back/Forward works through `popstate`;
- invalid initial hash resolves to Dashboard.

### Dashboard

- Runtime Overview does not render Version;
- other operational metrics remain;
- onboarding order/collapse invariants remain.

### CLI/build/static

- `start --ui` opens `/`;
- `--ui-react` is rejected/absent;
- no React alternate destination type remains;
- Vite base is `/`;
- Vite output is `dist/apps/web`;
- bootstrap allows only `/` for UI launch;
- static serving resolves the React app at `/`;
- vanilla source tree is absent from shipping/build contracts.

### Theme

- stored light/dark preference wins over OS preference;
- OS preference is used when no stored value exists;
- toggle is immediately left of Requests;
- toggle changes root theme and persists it;
- toggling theme does not change active page.

### Responsive

Use component/jsdom contracts plus Playwright viewport tests at representative widths such as:

```text
1440x900 desktop
834x1112 tablet
390x844 mobile
```

Cover:

- horizontal navigation and overflow;
- topbar controls;
- Settings forms;
- Dashboard grids;
- DataTable behavior;
- Requests drawer;
- at least one modal;
- long path/code values.

### Coverage and quality

Retain:

- 85% lines;
- 85% statements;
- 85% functions;
- 85% branches;
- TS <= 350 lines;
- TSX <= 400 lines;
- JS <= 350 lines;
- CSS <= 500 lines;
- Prettier formatting;
- semantic typecheck;
- Knip/dead-code checks.

Removal of vanilla code should simplify the combined web coverage configuration so it targets React only rather than keeping exclusions or dead compatibility suites.

## Dead-code Removal

Remove, after equivalent React coverage exists:

- `apps/web/**`;
- vanilla-specific web tests;
- vanilla copy/build code;
- `/react/` compatibility routing;
- `AdminUiDestination` alternate variants no longer needed;
- `--ui-react` help/completion/parser code;
- cross-UI parity tests whose only purpose was comparing React to vanilla;
- CSS imports pointing from React into vanilla styles.

Do not remove backend admin API tests or shared admin-contract tests that remain useful to the single UI.

## Documentation

Update user-facing documentation to describe React simply as "the Aevra Web UI".

Examples should use:

```text
aevra start --ui
```

No current documentation should instruct users to use `--ui-react` or `/react/`.

## Verification

The completion gate is:

```text
npm install
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run test:ui-parity (rename if parity no longer describes the React-only browser suite)
npm run build
```

Browser verification must explicitly reproduce the original race:

1. open a non-Dashboard page;
2. click Dashboard;
3. immediately click another tab;
4. wait longer than Dashboard's poll interval/network delay;
5. confirm the selected page does not change.

Also verify light/dark toggle persistence after reload and the three responsive viewport classes.
