# React UI Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clean React + TypeScript admin UI with feature/content/behavior parity to the modular vanilla UI and launch it with `aevra start --ui-react` while keeping one Core/API/auth runtime.

**Architecture:** Keep vanilla at `/` and serve the Vite-built React application at `/react/` from the existing authenticated admin server. Shared admin contracts define stable surface IDs, labels, approval scopes, page identities, and API-facing types; vanilla and React parity tests consume the same contract. React uses feature modules, typed same-origin services, focused hooks, and reusable presentation components rather than duplicating Core policy.

**Tech Stack:** React, React DOM, TypeScript, Vite, Vitest, React Testing Library, jsdom, Playwright for small built-UI smoke tests, existing Node/Core admin server, shared `packages/admin-contracts`.

**Spec:** `docs/superpowers/specs/2026-08-19-react-ui-maintainability-refactor-design.md`

**Prerequisite:** `docs/superpowers/plans/2026-08-19-maintainability-vanilla-refactor-plan.md` is complete and its final verification checkpoint passes.

## Global Constraints

- Target branch is `main`.
- `aevra start --ui` remains the vanilla UI.
- `aevra start --ui-react` opens React; passing both flags is an error.
- Both UIs use the same admin server, authentication cookie, API endpoints, request queue, permissions, workspaces, settings, and persistence.
- React parity means same pages, labels, sections, controls, actions, data, ordering, dialogs, permission/request behavior, loading/error/empty states, and x.ai visual language; screenshot-pixel identity is not required.
- Remote Access is the first block inside Onboarding in both UIs.
- Completed Onboarding moves to the Dashboard bottom and user collapse state survives polling.
- Source remains Prettier-formatted and readable. LOC limits remain `.ts` <=350, `.tsx` <=400, `.js` <=350, `.css` <=500, including tests.
- Maintained executable TS/TSX/JS must remain >=85% lines/statements/functions/branches coverage.
- Core remains the only source of authorization/security policy.
- Do not add GitHub Actions or other CI workflows.

---

### Task 1: Add shared admin contracts and stable parity identifiers

**Files:**
- Create: `packages/admin-contracts/admin-surface.json`
- Create: `packages/admin-contracts/src/api-types.ts`
- Create: `packages/admin-contracts/src/surface.ts`
- Create: `packages/admin-contracts/src/index.ts`
- Create: `packages/admin-contracts/test/surface.unit.test.ts`
- Modify: modular vanilla page/component files from Plan 1 to add `data-surface-id` attributes without changing visible UI.
- Create: `scripts/test/admin-surface-parity.test.mjs`

**Interfaces:**
- `ADMIN_SURFACE` exposes typed navigation/page/section/action identifiers.
- `surfaceId(category, id): string` returns the exact `data-surface-id` value used by both UIs.
- API types cover the response/request shapes shared by both clients; no Core business rules move here.

- [ ] **Step 1: Add a failing contract test**

`surface.unit.test.ts` must require stable identities:

```ts
assert.deepEqual(ADMIN_SURFACE.navigation.map((item) => item.id), [
  'dashboard',
  'permissions',
  'workspaces',
  'sessions',
  'processes',
  'changes',
  'audit',
  'settings',
  'guide',
]);

assert.deepEqual(ADMIN_SURFACE.onboarding.beforeCompletion, [
  'remote-access',
  'connect-ai',
  'workspace',
  'try-aevra',
  'finish-onboarding',
]);

assert.deepEqual(ADMIN_SURFACE.approvalScopes, ['once', 'session', 'workspace', 'global']);
```

- [ ] **Step 2: Run and verify RED**

```bash
npm run test:unit
```

Expected: `packages/admin-contracts` does not exist.

- [ ] **Step 3: Create the manifest**

`admin-surface.json` must contain at least:

```json
{
  "navigation": [
    { "id": "dashboard", "label": "Dashboard" },
    { "id": "permissions", "label": "Permissions" },
    { "id": "workspaces", "label": "Workspaces" },
    { "id": "sessions", "label": "Sessions" },
    { "id": "processes", "label": "Processes" },
    { "id": "changes", "label": "Changes" },
    { "id": "audit", "label": "Audit" },
    { "id": "settings", "label": "Settings" },
    { "id": "guide", "label": "Guide" }
  ],
  "dashboardSections": [
    "onboarding",
    "runtime-overview",
    "active-connections",
    "tool-activity",
    "connections",
    "recent-activity"
  ],
  "onboarding": {
    "beforeCompletion": ["remote-access", "connect-ai", "workspace", "try-aevra", "finish-onboarding"],
    "completedPosition": "bottom"
  },
  "approvalScopes": ["once", "session", "workspace", "global"]
}
```

Extend the same file with key action IDs for Permissions, Workspaces, Sessions, Requests, Settings, Guide, Processes, Changes, and connector actions as React implementation reaches each feature.

- [ ] **Step 4: Add typed API shapes**

Create focused interfaces used by clients, for example:

```ts
export interface OnboardingStatus {
  completed: boolean;
  completedSections: string[];
}

export interface ApprovalPresentation {
  title: string;
  action: string;
  target: string;
  preview?: string;
}

export interface ApprovalItem {
  id: string;
  state: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  actor: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  operation: { family: string; capability: string };
  payload?: Record<string, unknown>;
  presentation?: ApprovalPresentation;
}
```

Add types only for data actually consumed by the admin clients; do not mirror internal repository/database records wholesale.

- [ ] **Step 5: Add stable identifiers to vanilla**

Use attributes such as:

```html
<section data-surface-id="dashboard:onboarding">...</section>
<button data-surface-id="requests:approve-global">Always globally</button>
```

No visible label/order changes in this step.

- [ ] **Step 6: Add vanilla contract test**

`admin-surface-parity.test.mjs` reads `admin-surface.json` and modular vanilla source/index, asserting every navigation ID and required Dashboard/Requests/admin action has a corresponding `data-surface-id` contract.

- [ ] **Step 7: Verify and commit**

```bash
npm run test:unit
npm run test:web
npm run lint:loc
npm run typecheck
git add packages/admin-contracts apps/web scripts/test
git commit -m "feat: add shared admin surface contracts"
```

---

### Task 2: Scaffold the React/Vite application and typed API foundation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `apps/web-react/index.html`
- Create: `apps/web-react/vite.config.ts`
- Create: `apps/web-react/tsconfig.json`
- Create: `apps/web-react/src/main.tsx`
- Create: `apps/web-react/src/app/App.tsx`
- Create: `apps/web-react/src/app/navigation.ts`
- Create: `apps/web-react/src/app/use-hash-page.ts`
- Create: `apps/web-react/src/components/AppShell.tsx`
- Create: `apps/web-react/src/components/PageState.tsx`
- Create: `apps/web-react/src/services/api-client.ts`
- Create: `apps/web-react/src/hooks/use-polling-resource.ts`
- Create: `apps/web-react/src/styles/tokens.css`
- Create: `apps/web-react/src/styles/shell.css`
- Create: `apps/web-react/src/test/setup.ts`
- Create: `apps/web-react/src/app/App.test.tsx`
- Modify: `vitest.web.config.ts`
- Modify: `tsconfig.typecheck.json`

**Interfaces:**
- `requestJson<T>(path, init?): Promise<T>` is the only low-level HTTP primitive used by React features.
- `usePollingResource<T>({ load, intervalMs, enabled })` owns one timer and abort cleanup.
- `AppShell` renders shared navigation using `ADMIN_SURFACE` labels/IDs.

- [ ] **Step 1: Install React/Vite/testing dependencies**

```bash
npm install react react-dom
npm install --save-dev vite @vitejs/plugin-react @types/react @types/react-dom @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test
```

- [ ] **Step 2: Add failing app-shell test**

```tsx
render(<App />);
for (const item of ADMIN_SURFACE.navigation) {
  expect(screen.getByRole('button', { name: item.label })).toBeInTheDocument();
}
expect(screen.getByTestId('react-admin-root')).toBeInTheDocument();
```

- [ ] **Step 3: Run and verify RED**

```bash
vitest run --config vitest.web.config.ts apps/web-react/src/app/App.test.tsx
```

Expected: React app modules are missing.

- [ ] **Step 4: Configure Vite**

Use `/react/` as the production base and do not empty the vanilla output directory:

```ts
export default defineConfig({
  base: '/react/',
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@aevra/admin-contracts': fileURLToPath(
        new URL('../../packages/admin-contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: '../../dist/apps/web/react',
    emptyOutDir: false,
  },
});
```

- [ ] **Step 5: Implement the typed API client**

```ts
export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const value = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(value?.error?.message ?? value?.message ?? `HTTP ${response.status}`);
  }
  return value as T;
}
```

All feature services wrap this function with typed endpoint-specific methods.

- [ ] **Step 6: Implement navigation without a router dependency**

`useHashPage()` maps `location.hash` to a valid `ADMIN_SURFACE.navigation` ID and falls back to `dashboard`. It registers exactly one `hashchange` listener and removes it on cleanup.

`App.tsx` uses a page registry; do not define page components inline.

- [ ] **Step 7: Add polling hook tests**

Use fake timers to assert one immediate load, scheduled refresh, no load while disabled, and cleanup on unmount. Use `AbortController` or a request-generation token so stale responses cannot overwrite newer state.

- [ ] **Step 8: Extend web coverage/typecheck configs**

`vitest.web.config.ts` must include both `apps/web/test/**/*.test.js` and `apps/web-react/src/**/*.test.{ts,tsx}`, use jsdom, and enforce:

```ts
thresholds: { lines: 85, statements: 85, functions: 85, branches: 85 }
```

`tsconfig.typecheck.json` invokes a React config via project references or the top-level `typecheck` script runs both configs. Do not put `noCheck: true` into the React config.

- [ ] **Step 9: Verify and commit**

```bash
npm run typecheck
vitest run --config vitest.web.config.ts
npm run lint:loc
git add package.json package-lock.json apps/web-react vitest.web.config.ts tsconfig.typecheck.json
git commit -m "feat: scaffold react admin ui"
```

---

### Task 3: Implement React Dashboard, Onboarding, Remote Access, Requests, and Guide

**Files:**
- Create: `apps/web-react/src/features/dashboard/dashboard-service.ts`
- Create: `apps/web-react/src/features/dashboard/DashboardPage.tsx`
- Create: `apps/web-react/src/features/dashboard/DashboardSection.tsx`
- Create: `apps/web-react/src/features/dashboard/OnboardingPanel.tsx`
- Create: `apps/web-react/src/features/dashboard/RemoteAccessPanel.tsx`
- Create: `apps/web-react/src/features/dashboard/dashboard-order.ts`
- Create: `apps/web-react/src/features/dashboard/dashboard.test.tsx`
- Create: `apps/web-react/src/features/requests/requests-service.ts`
- Create: `apps/web-react/src/features/requests/RequestDrawer.tsx`
- Create: `apps/web-react/src/features/requests/request-actions.ts`
- Create: `apps/web-react/src/features/requests/requests.test.tsx`
- Create: `apps/web-react/src/features/guide/GuidePage.tsx`
- Create: `apps/web-react/src/features/guide/SafeMatcherGuide.tsx`
- Create: `apps/web-react/src/features/guide/guide.test.tsx`
- Create: `apps/web-react/src/styles/dashboard.css`
- Create: `apps/web-react/src/styles/requests.css`

**Interfaces:**
- `dashboardOrder(completed: boolean): DashboardSectionId[]` matches the shared contract.
- `actionsForApproval(item): ApprovalAction[]` hides persistent scopes for CRITICAL requests.
- `DashboardPage` fetches independent resources in parallel and preserves local collapsed state across polling.

- [ ] **Step 1: Add failing pure order/action tests**

```ts
expect(dashboardOrder(false)[0]).toBe('onboarding');
expect(dashboardOrder(true).at(-1)).toBe('onboarding');
expect(actionsForApproval(nonCritical).map((x) => x.scope)).toEqual([
  'once', 'session', 'workspace', 'global',
]);
expect(actionsForApproval(critical).map((x) => x.scope)).toEqual(['once']);
```

- [ ] **Step 2: Add failing rendered Dashboard tests**

Mock API responses and assert:

```tsx
const onboarding = screen.getByTestId('surface-dashboard:onboarding');
expect(within(onboarding).getByText('Remote Access')).toBeInTheDocument();
expect(within(onboarding).getByText('Connect an AI')).toBeInTheDocument();
```

For completed state, compare DOM order and assert Onboarding is the last top-level Dashboard section.

- [ ] **Step 3: Implement Dashboard services with parallel requests**

Use `Promise.all` for independent `/api/status`, `/api/cloudflare/status`, `/api/onboarding`, `/api/workspaces`, `/api/dashboard/runtime`, and connector data. Do not serialize requests that do not depend on each other.

- [ ] **Step 4: Implement Remote Access actions**

Match vanilla endpoints and labels:

```text
POST /api/cloudflare/authenticate
POST /api/cloudflare/setup
POST /api/cloudflare/test
```

Keep Public MCP hostname, Tunnel ID, ownership, current auth/status text, endpoint Copy, Test endpoint, Authenticate/Check authentication, Save remote access, and Advanced Cloudflare Access display.

- [ ] **Step 5: Implement collapse-state preservation**

`DashboardSection` uses local React state initialized to `true`. Polling updates content props only; it never resets the local `open` state.

- [ ] **Step 6: Implement Requests drawer**

Poll `/api/approvals` and `/api/oauth/requests` with one hook owner. Render server-provided `presentation.title/action/target/preview`, Saved matcher for `commands.run`, and exact scoped actions. Persistent CRITICAL buttons must never render.

Approval mutation uses the existing admin endpoint and scope values already used by vanilla; after success refetch Requests and show the same toast wording class as vanilla.

- [ ] **Step 7: Implement Guide + Copy All**

Consume the same Safe Command Matcher catalog/contract as vanilla tests. Copy All copies the currently selected platform matchers joined with `\n`; individual Copy remains available.

- [ ] **Step 8: Verify feature tests, coverage, and LOC**

```bash
vitest run --config vitest.web.config.ts apps/web-react/src/features/dashboard apps/web-react/src/features/requests apps/web-react/src/features/guide
npm run test:coverage:web
npm run lint:loc
```

- [ ] **Step 9: Commit**

```bash
git add apps/web-react/src/features apps/web-react/src/styles
git commit -m "feat: add react dashboard requests and guide"
```

---

### Task 4: Implement React Permissions, Workspaces, Sessions, Audit, and Settings

**Files:**
- Create feature folders under `apps/web-react/src/features/permissions/`, `workspaces/`, `sessions/`, `audit/`, `settings/`.
- Create shared: `apps/web-react/src/components/DataTable.tsx`
- Create shared: `apps/web-react/src/components/Modal.tsx`
- Create shared: `apps/web-react/src/components/ToastProvider.tsx`
- Create shared: `apps/web-react/src/components/FormField.tsx`
- Create: `apps/web-react/src/styles/admin.css`
- Create focused tests in each feature folder.

**Interfaces:**
- `DataTable<T>` supports search, filters, sort, pagination, page sizes 10/25/50/100, empty state, and row actions.
- Feature services wrap exact existing admin endpoints; components never build raw fetch calls.

- [ ] **Step 1: Build DataTable with failing behavior tests**

Tests must cover search, one and multiple filters, ascending/descending sort, next/previous page, page-size change, empty state, and row action callback.

Component API:

```ts
export interface DataTableProps<T> {
  id: string;
  rows: readonly T[];
  columns: readonly Column<T>[];
  filters?: readonly FilterDefinition<T>[];
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
  pageSize?: 10 | 25 | 50 | 100;
  onAction?: (action: string, row: T) => void | Promise<void>;
}
```

- [ ] **Step 2: Implement Permissions parity**

Match vanilla table/search/pagination/filters: Effect, Capability, Scope, Actor. Preserve add-rule/bulk flow, command matcher input, broad `*` warning, exact scope/actor/workspace/session targeting, and Revoke.

- [ ] **Step 3: Implement Workspaces parity**

Match workspace list search/pagination, external-mount filter, Details/Remove, Add workspace, mount creation/removal, actor admission mapping, and danger-zone removal.

- [ ] **Step 4: Implement Sessions parity**

Remote table: Actor + Workspace state filters, Switch, Revoke. Local table: search/pagination + Revoke. Preserve Revoke all others behavior and confirmation copy.

- [ ] **Step 5: Implement Audit parity**

Render chain-integrity state, actor/operation/target search, JSON/JSONL export links, and Clear history confirmation/action.

- [ ] **Step 6: Implement Settings parity**

Preserve execution settings, configuration export, command-family overrides, network rules, environment profiles, secret references, and Remote Access/settings integration already present in vanilla.

- [ ] **Step 7: Run feature tests and web coverage**

```bash
vitest run --config vitest.web.config.ts apps/web-react/src/features/permissions apps/web-react/src/features/workspaces apps/web-react/src/features/sessions apps/web-react/src/features/audit apps/web-react/src/features/settings
npm run test:coverage:web
npm run lint:loc
```

Expected: feature tests pass; every TSX <=400, TS <=350, CSS <=500.

- [ ] **Step 8: Commit**

```bash
git add apps/web-react/src/components apps/web-react/src/features apps/web-react/src/styles/admin.css
git commit -m "feat: add react admin management pages"
```

---

### Task 5: Implement React Processes, Changes, Connections, and remaining surface parity

**Files:**
- Create feature folders: `apps/web-react/src/features/processes/`, `changes/`, `connections/`.
- Modify: `apps/web-react/src/app/App.tsx`
- Modify: `packages/admin-contracts/admin-surface.json`
- Create/modify focused tests.

**Interfaces:**
- Every remaining navigation entry in `ADMIN_SURFACE.navigation` resolves to a real feature page.
- Connections/connector actions use the same API and one-time token presentation as vanilla.

- [ ] **Step 1: Add failing navigation parity test**

Iterate every shared navigation entry, click it, and assert a page root with `data-surface-id="page:<id>"` appears.

- [ ] **Step 2: Implement Processes page**

Preserve managed-process list/status, logs where exposed, stop/restart/local ownership states, and detached/uncertain presentation. Do not move process authorization logic into React.

- [ ] **Step 3: Implement Changes page**

Preserve open change sets, diff/preview information, rollback/restore actions currently exposed, confirmations, and error states.

- [ ] **Step 4: Implement Connections/connector actions**

Preserve connector creation/revoke, show one-time token once, current failed-attempt warning, active connection data, and OAuth-related request state shown by vanilla.

- [ ] **Step 5: Complete parity manifest**

Add stable action/section IDs for every user-visible vanilla capability now implemented in React. The manifest must not contain an entry that is absent from either UI.

- [ ] **Step 6: Verify React component/integration suite**

```bash
vitest run --config vitest.web.config.ts
npm run test:coverage:web
npm run lint:loc
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/web-react packages/admin-contracts
git commit -m "feat: complete react admin surface"
```

---

### Task 6: Add safe `/react/` serving and `aevra start --ui-react`

**Files:**
- Modify: `apps/cli/src/args.ts`
- Modify: CLI handler/admin-session modules created by Plan 1.
- Modify: `apps/cli/test/args.unit.test.ts`
- Create: `apps/cli/test/ui-launch.unit.test.ts`
- Modify: `apps/core/src/admin/server.ts`
- Create: `apps/core/src/admin/bootstrap-destination.ts`
- Create: `apps/core/src/admin/static-files.ts`
- Create/modify admin server security/integration tests.
- Modify: `scripts/copy-static.mjs`
- Modify: `package.json`
- Modify: `package-lock.json` if scripts/dependency resolution changes it.

**Interfaces:**
- `UiLaunch = 'none' | 'vanilla' | 'react'`.
- `parseAdminDestination(value): '/' | '/react/' | null` accepts only the two approved destinations.
- `resolveStaticAsset(staticDir, pathname)` safely resolves files/directories within the static root and maps `/react/` to `react/index.html`.

- [ ] **Step 1: Add failing CLI parser tests**

```ts
assert.deepEqual(parseAevraArgs(['start', '--ui']), { command: 'start', ui: 'vanilla' });
assert.deepEqual(parseAevraArgs(['start', '--ui-react']), { command: 'start', ui: 'react' });
assert.throws(
  () => parseAevraArgs(['start', '--ui', '--ui-react']),
  /cannot be used together/i,
);
```

No UI flag returns `{ command: 'start', ui: 'none' }`.

- [ ] **Step 2: Add failing safe-destination tests**

```ts
assert.equal(parseAdminDestination(undefined), '/');
assert.equal(parseAdminDestination('/'), '/');
assert.equal(parseAdminDestination('/react/'), '/react/');
assert.equal(parseAdminDestination('https://evil.example'), null);
assert.equal(parseAdminDestination('//evil.example'), null);
assert.equal(parseAdminDestination('/react/../../secret'), null);
```

Add integration coverage that an invalid `next` returns HTTP 400 before a bootstrap token is consumed.

- [ ] **Step 3: Add failing static resolver tests**

With a temp static tree containing `index.html` and `react/index.html`, require:

```text
/ -> index.html
/react/ -> react/index.html
/react/assets/app.js -> react/assets/app.js
/../../secret -> null
```

- [ ] **Step 4: Implement CLI launch selection**

Change the start command type to `ui: UiLaunch`. On daemon ready:

```ts
if (command.ui === 'vanilla') await openAuthenticatedUi(config, '/');
if (command.ui === 'react') await openAuthenticatedUi(config, '/react/');
```

`openAuthenticatedUi()` issues the same local bootstrap token and opens:

```ts
`${localAdminBase(config)}/auth/bootstrap?token=${encodeURIComponent(token)}&next=${encodeURIComponent(destination)}`
```

Existing `aevra ui` remains vanilla.

- [ ] **Step 5: Implement safe bootstrap destination**

In the admin server, validate `next` before consuming the token. On valid bootstrap, set the same cookie and redirect to the validated path. Invalid destination returns JSON 400 and leaves the one-time token unconsumed.

- [ ] **Step 6: Implement safe static directory indexing**

Move path resolution/content-type logic out of `server.ts` into `static-files.ts`. Directory URLs append `index.html`; resolved files must remain within the configured static root after `path.resolve`.

Support at least HTML, JS, CSS, JSON, SVG, PNG, ICO, and source map MIME types needed by Vite output.

- [ ] **Step 7: Update build order**

Use this order so vanilla copying does not delete the React build:

```json
{
  "build:core": "tsc -p tsconfig.build.json",
  "build:vanilla": "node scripts/check-web-syntax.mjs && node scripts/copy-static.mjs",
  "build:react": "vite build --config apps/web-react/vite.config.ts",
  "build": "npm run build:core && npm run build:vanilla && npm run build:react"
}
```

`copy-static.mjs` may clear `dist/apps/web` before copying vanilla; Vite runs after it and writes `dist/apps/web/react` with `emptyOutDir: false`.

- [ ] **Step 8: Run focused CLI/admin/build tests**

```bash
npm run test:unit
npm run test:integration
npm run typecheck
npm run build
```

Verify both `dist/apps/web/index.html` and `dist/apps/web/react/index.html` exist.

- [ ] **Step 9: Commit**

```bash
git add apps/cli apps/core/src/admin scripts package.json package-lock.json
git commit -m "feat: launch react admin ui"
```

---

### Task 7: Add built-UI cross-parity smoke tests and close final 85% coverage

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/ui-parity/static-server.mjs`
- Create: `tests/ui-parity/api-fixtures.ts`
- Create: `tests/ui-parity/parity.spec.ts`
- Create: `tests/ui-parity/onboarding.spec.ts`
- Create: `tests/ui-parity/requests.spec.ts`
- Modify: `package.json`
- Modify: `vitest.web.config.ts`
- Add focused tests wherever the coverage report identifies reachable gaps.

**Interfaces:**
- Built-UI smoke tests use the same fixture responses and `data-surface-id` selectors for vanilla and React.
- `test:ui-parity` builds both UIs, serves `dist/apps/web`, intercepts/fakes `/api/**`, and runs Chromium smoke tests.

- [ ] **Step 1: Add Playwright script**

```json
{
  "test:ui-parity": "npm run build && playwright test --config playwright.config.ts"
}
```

`playwright.config.ts` uses one Chromium project and starts:

```text
node tests/ui-parity/static-server.mjs
```

on a fixed test-only localhost port. The server only serves `dist/apps/web`; API requests are fulfilled by Playwright route handlers using `api-fixtures.ts`.

- [ ] **Step 2: Create shared parity helper**

```ts
async function forEachUi(page, callback) {
  for (const [name, path] of [['vanilla', '/'], ['react', '/react/']] as const) {
    await page.goto(path);
    await callback(name);
  }
}
```

Selectors use `data-surface-id`, not implementation-specific class names.

- [ ] **Step 3: Test navigation and page surfaces in both UIs**

For every `ADMIN_SURFACE.navigation` entry, click the matching nav action and assert the expected page root and primary actions exist.

- [ ] **Step 4: Test Onboarding parity in both states**

Fixture A: `completed: false` — assert Onboarding is before runtime sections and Remote Access is the first Onboarding child.

Fixture B: `completed: true` — assert Onboarding is the last Dashboard section. Collapse it, advance/wait through one polling interval, assert it remains collapsed.

- [ ] **Step 5: Test Requests parity**

Non-critical fixture: assert Deny, Run once, Allow this session, Always in workspace, Always globally, presentation, and Saved matcher.

CRITICAL fixture: assert persistent buttons do not exist and Run once remains.

- [ ] **Step 6: Add high-value admin smoke flows**

Using route interception/stateful fixtures, exercise at least:

```text
Permissions search/filter and Revoke
Workspace Details and Switch/Remove controls
Sessions workspace filter and Revoke
Guide Copy All
Settings form presence and save request
Process stop/restart controls
Change rollback control
connector creation one-time token presentation
```

Do not duplicate every unit test in Playwright; keep this suite small and workflow-oriented.

- [ ] **Step 7: Run coverage and close reachable gaps**

```bash
npm run test:coverage
```

Both groups must pass >=85 lines/statements/functions/branches. Add behavior tests for reachable gaps; do not use blanket coverage-ignore comments.

- [ ] **Step 8: Run all final gates locally**

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run test:ui-parity
npm run build
```

Expected: every command exits 0.

- [ ] **Step 9: Manual launch verification**

```bash
npm link
aevra start --ui-react
```

Verify the browser opens the authenticated `/react/` UI and the same local Core state is visible as vanilla. Stop Aevra, then run:

```bash
aevra start --ui
```

Verify vanilla still opens at `/` with the same stored workspaces, permissions, sessions, settings, requests, and onboarding state.

- [ ] **Step 10: Verify no source-policy regressions**

```bash
npm run lint:loc
npm run lint:deadcode
git ls-files '.github/workflows/*'
```

Expected: LOC/dead-code checks pass and the workflow listing is empty.

- [ ] **Step 11: Commit final parity/coverage work**

```bash
git add -A
git commit -m "test: enforce vanilla react parity"
```

- [ ] **Step 12: Record final main SHA**

```bash
git rev-parse HEAD
```

Use this SHA in the completion report together with exact outputs from format, lint, typecheck, tests, coverage, parity smoke, and build.
