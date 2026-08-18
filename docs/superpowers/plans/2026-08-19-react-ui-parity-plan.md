# React UI Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clean React + TypeScript admin UI with feature/content/behavior parity to the modular vanilla UI and launch it with `aevra start --ui-react` while keeping one Core/API/auth runtime.

**Architecture:** Keep vanilla at `/` and serve the Vite-built React application at `/react/` from the existing authenticated admin server. Shared admin contracts define stable surface IDs, labels, approval scopes, page identities, and API-facing types; vanilla and React parity tests consume the same contract. React uses feature modules, typed same-origin services, focused hooks, and reusable presentation components rather than duplicating Core policy.

**Tech Stack:** React, React DOM, TypeScript, Vite, Vitest, React Testing Library, jsdom, Playwright, existing Node/Core admin server, shared `packages/admin-contracts`.

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
- Modify: `apps/web/main.js`
- Modify: `apps/web/components/request-drawer.js`
- Modify: `apps/web/components/remote-access.js`
- Modify: `apps/web/components/onboarding.js`
- Modify: each `apps/web/pages/*.js` page module created by Plan 1.
- Create: `scripts/test/admin-surface-parity.test.mjs`

**Interfaces:**
- `ADMIN_SURFACE` exposes typed navigation/page/section/action identifiers.
- `surfaceId(category, id): string` returns the exact `data-surface-id` value used by both UIs.
- API types cover only response/request shapes consumed by both clients.

- [ ] **Step 1: Add a failing contract test**

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

assert.deepEqual(ADMIN_SURFACE.approvalScopes, [
  'once',
  'session',
  'workspace',
  'global',
]);
```

- [ ] **Step 2: Run and verify RED**

```bash
npm run test:unit
```

Expected: `packages/admin-contracts` does not exist.

- [ ] **Step 3: Create the complete first-version surface manifest**

`admin-surface.json`:

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
    "beforeCompletion": [
      "remote-access",
      "connect-ai",
      "workspace",
      "try-aevra",
      "finish-onboarding"
    ],
    "completedPosition": "bottom"
  },
  "approvalScopes": ["once", "session", "workspace", "global"],
  "actions": {
    "requests": ["deny", "approve-once", "approve-session", "approve-workspace", "approve-global"],
    "permissions": ["add", "revoke", "filter-effect", "filter-capability", "filter-scope", "filter-actor"],
    "workspaces": ["add", "details", "remove", "add-mount", "remove-mount", "save-admission"],
    "sessions": ["switch-workspace", "revoke", "revoke-all-others"],
    "processes": ["view-logs", "stop", "restart"],
    "changes": ["preview", "rollback"],
    "audit": ["export-json", "export-jsonl", "clear"],
    "settings": ["save-execution", "save-command-family", "add-network-rule", "create-environment-profile", "store-secret"],
    "guide": ["copy-matcher", "copy-all-matchers"],
    "connections": ["create-connector", "revoke-connector"],
    "remoteAccess": ["authenticate", "test-endpoint", "save", "copy-endpoint"]
  }
}
```

- [ ] **Step 4: Add typed API shapes**

Create focused interfaces including:

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

export interface WorkspaceSummary {
  id: string;
  name: string;
  hostRoot?: string;
  description?: string;
}

export interface RemoteSessionSummary {
  id: string;
  actor: string;
  activeLeaseId?: string | null;
  lastActivityAt?: string;
  lease?: { workspaceId?: string | null };
}
```

Add further page-specific shapes only when their feature task consumes them.

- [ ] **Step 5: Add stable identifiers to vanilla**

Use real content inside the element rather than empty marker wrappers:

```html
<section data-surface-id="dashboard:onboarding" class="dashboard-section">
  <summary>Onboarding</summary>
</section>
<button data-surface-id="requests:approve-global">Always globally</button>
```

Each page root uses `data-surface-id="page:<page-id>"` and each key action uses the IDs from the manifest.

- [ ] **Step 6: Add vanilla contract test**

`admin-surface-parity.test.mjs` parses `admin-surface.json` and requires the modular vanilla source to contain a page root for every navigation ID and action identifiers for every manifest action group that the page owns.

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
- Create: `apps/web-react/src/hooks/use-polling-resource.test.tsx`
- Modify: `vitest.web.config.ts`
- Modify: `package.json` typecheck script so it runs both Node and React configs.

**Interfaces:**
- `requestJson<T>(path, init?): Promise<T>` is the only low-level HTTP primitive used by React features.
- `usePollingResource<T>({ load, intervalMs, enabled })` owns one timer and deterministic cleanup.
- `AppShell` renders shared navigation from `ADMIN_SURFACE`.

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
export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const value = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      value?.error?.message ?? value?.message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return value as T;
}
```

Feature services wrap this function and expose typed endpoint methods.

- [ ] **Step 6: Implement navigation without a router dependency**

`useHashPage()` maps `location.hash` to a valid `ADMIN_SURFACE.navigation` ID and falls back to `dashboard`. It registers one `hashchange` listener and removes it on cleanup.

`App.tsx` imports page components from their feature modules and keeps the page registry outside the component body.

- [ ] **Step 7: Add polling-hook tests and implementation**

Use fake timers to assert one immediate load, one scheduled refresh per interval, no refresh while disabled, cleanup on unmount, and protection against stale-response overwrite. Implement with an `AbortController` per request generation.

- [ ] **Step 8: Extend web coverage and typecheck configs**

`vitest.web.config.ts` matches both:

```text
apps/web/test/**/*.test.js
apps/web-react/src/**/*.test.ts
apps/web-react/src/**/*.test.tsx
```

Coverage includes modular vanilla JS plus `apps/web-react/src/**/*.{ts,tsx}` and enforces 85 for lines/statements/functions/branches.

`apps/web-react/tsconfig.json` uses `jsx: react-jsx`, DOM libraries, strict semantic checking, and the `@aevra/admin-contracts` path alias. Set the top-level script to:

```json
{
  "typecheck": "tsc -p tsconfig.typecheck.json --noEmit && tsc -p apps/web-react/tsconfig.json --noEmit"
}
```

- [ ] **Step 9: Verify and commit**

```bash
npm run typecheck
vitest run --config vitest.web.config.ts
npm run lint:loc
git add package.json package-lock.json apps/web-react vitest.web.config.ts
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
expect(actionsForApproval(nonCritical).map((item) => item.scope)).toEqual([
  'once',
  'session',
  'workspace',
  'global',
]);
expect(actionsForApproval(critical).map((item) => item.scope)).toEqual([
  'once',
]);
```

- [ ] **Step 2: Add failing rendered Dashboard tests**

```tsx
const onboarding = screen.getByTestId('surface-dashboard:onboarding');
expect(within(onboarding).getByText('Remote Access')).toBeInTheDocument();
expect(within(onboarding).getByText('Connect an AI')).toBeInTheDocument();
```

For `completed: true`, compare top-level `data-surface-id` values and require `dashboard:onboarding` to be last.

- [ ] **Step 3: Implement Dashboard service with parallel requests**

Use one `Promise.all` for `/api/status`, `/api/cloudflare/status`, `/api/onboarding`, `/api/workspaces`, `/api/dashboard/runtime`, and `/api/connectors`. Return one typed Dashboard view model.

- [ ] **Step 4: Implement Remote Access parity**

Use exact endpoints:

```text
POST /api/cloudflare/authenticate
POST /api/cloudflare/setup
POST /api/cloudflare/test
```

Render Public MCP hostname, Tunnel ID, ownership, provider/authentication status, Canonical MCP endpoint, Copy, Test endpoint, Authenticate/Check authentication, Save remote access, and Advanced: Cloudflare Access.

- [ ] **Step 5: Implement collapse-state preservation**

`DashboardSection` initializes `open` to `true`; polling changes children/data props only and never writes to `open`. Add a test that collapses the section, resolves a second polling response, and asserts it stays collapsed.

- [ ] **Step 6: Implement Requests drawer**

Poll `/api/approvals` and `/api/oauth/requests` through one `usePollingResource` owner. Render server `presentation.title`, `action`, `target`, `preview`, plus Saved matcher for `commands.run`. Non-critical commands expose deny/once/session/workspace/global. CRITICAL commands expose deny/once only.

Use the same approval endpoint and scope values already exercised by the vanilla implementation; put that endpoint in `requests-service.ts` as a typed method and test its path/body exactly.

- [ ] **Step 7: Implement Guide + Copy All**

Use the same Safe Command Matcher catalog data as the vanilla Guide. Copy All writes current-platform matcher values joined with `\n`; individual Copy writes one matcher.

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
- Create: `apps/web-react/src/components/DataTable.tsx`
- Create: `apps/web-react/src/components/DataTable.test.tsx`
- Create: `apps/web-react/src/components/Modal.tsx`
- Create: `apps/web-react/src/components/ToastProvider.tsx`
- Create: `apps/web-react/src/components/FormField.tsx`
- Create: `apps/web-react/src/features/permissions/permissions-service.ts`
- Create: `apps/web-react/src/features/permissions/PermissionsPage.tsx`
- Create: `apps/web-react/src/features/permissions/permissions.test.tsx`
- Create: `apps/web-react/src/features/workspaces/workspaces-service.ts`
- Create: `apps/web-react/src/features/workspaces/WorkspacesPage.tsx`
- Create: `apps/web-react/src/features/workspaces/WorkspaceDetailsModal.tsx`
- Create: `apps/web-react/src/features/workspaces/workspaces.test.tsx`
- Create: `apps/web-react/src/features/sessions/sessions-service.ts`
- Create: `apps/web-react/src/features/sessions/SessionsPage.tsx`
- Create: `apps/web-react/src/features/sessions/sessions.test.tsx`
- Create: `apps/web-react/src/features/audit/audit-service.ts`
- Create: `apps/web-react/src/features/audit/AuditPage.tsx`
- Create: `apps/web-react/src/features/audit/audit.test.tsx`
- Create: `apps/web-react/src/features/settings/settings-service.ts`
- Create: `apps/web-react/src/features/settings/SettingsPage.tsx`
- Create: `apps/web-react/src/features/settings/settings.test.tsx`
- Create: `apps/web-react/src/styles/admin.css`

**Interfaces:**
- `DataTable<T>` supports search, filters, sort, pagination, page sizes 10/25/50/100, empty state, and row actions.
- Feature services own exact endpoint paths and request bodies; components call service methods rather than raw `fetch`.

- [ ] **Step 1: Build DataTable with failing behavior tests**

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

Tests cover search, multiple filters, ascending/descending sort, next/previous page, page-size change, empty state, and row action callback.

- [ ] **Step 2: Implement Permissions parity**

Render the same table fields, search, pagination, Effect/Capability/Scope/Actor filters, add/bulk rule flow, command matcher textarea, broad `*` warning, target scopes, and Revoke action.

- [ ] **Step 3: Implement Workspaces parity**

Render workspace search/pagination, External mounts filter, Add workspace, Details, Remove, mount create/remove, actor admission, and danger-zone removal.

- [ ] **Step 4: Implement Sessions parity**

Remote table exposes Actor + Workspace state filters, Switch, Revoke. Local table exposes search/pagination and Revoke. Preserve Revoke all others confirmation and mutation.

- [ ] **Step 5: Implement Audit parity**

Render hash-chain integrity, actor/operation/target filter, Export JSON, Export JSONL, and Clear history confirmation/action.

- [ ] **Step 6: Implement Settings parity**

Render execution settings, local/portable config export, command-family overrides, network rules, environment profiles, secret references, and every save/delete action currently in vanilla.

- [ ] **Step 7: Run feature tests and coverage**

```bash
vitest run --config vitest.web.config.ts apps/web-react/src/components/DataTable.test.tsx apps/web-react/src/features/permissions apps/web-react/src/features/workspaces apps/web-react/src/features/sessions apps/web-react/src/features/audit apps/web-react/src/features/settings
npm run test:coverage:web
npm run lint:loc
```

Expected: all feature tests pass; TS <=350, TSX <=400, CSS <=500.

- [ ] **Step 8: Commit**

```bash
git add apps/web-react/src/components apps/web-react/src/features apps/web-react/src/styles/admin.css
git commit -m "feat: add react admin management pages"
```

---

### Task 5: Implement React Processes, Changes, and Connections

**Files:**
- Create: `apps/web-react/src/features/processes/processes-service.ts`
- Create: `apps/web-react/src/features/processes/ProcessesPage.tsx`
- Create: `apps/web-react/src/features/processes/processes.test.tsx`
- Create: `apps/web-react/src/features/changes/changes-service.ts`
- Create: `apps/web-react/src/features/changes/ChangesPage.tsx`
- Create: `apps/web-react/src/features/changes/changes.test.tsx`
- Create: `apps/web-react/src/features/connections/connections-service.ts`
- Create: `apps/web-react/src/features/connections/ConnectionsPanel.tsx`
- Create: `apps/web-react/src/features/connections/connections.test.tsx`
- Modify: `apps/web-react/src/app/App.tsx`
- Modify: `packages/admin-contracts/admin-surface.json` only if implementation proves a listed action is not actually present in vanilla; such a change must update both parity tests in the same commit.

**Interfaces:**
- Every `ADMIN_SURFACE.navigation` page has a real React page root.
- Connections use the same connector API and one-time token behavior as vanilla.

- [ ] **Step 1: Add failing navigation parity test**

Iterate every shared navigation entry, click it, and require `data-surface-id="page:<id>"`.

- [ ] **Step 2: Implement Processes page**

Render managed process list/status, logs action, stop, restart, ownership state, and detached/uncertain presentation. React only invokes existing process APIs; authorization remains server-side.

- [ ] **Step 3: Implement Changes page**

Render open change sets, preview/diff data currently shown by vanilla, rollback action, confirmation, success toast, and error state.

- [ ] **Step 4: Implement Connections panel**

Render connector creation/revoke, failed-admission warning, active connection data, OAuth-related pending state, and one-time connector token display exactly once after creation.

- [ ] **Step 5: Verify all React page roots and web coverage**

```bash
vitest run --config vitest.web.config.ts
npm run test:coverage:web
npm run lint:loc
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web-react packages/admin-contracts
git commit -m "feat: complete react admin surface"
```

---

### Task 6: Add safe `/react/` serving and `aevra start --ui-react`

**Files:**
- Modify: `apps/cli/src/args.ts`
- Modify: `apps/cli/src/admin-session.ts`
- Modify: `apps/cli/src/commands/start-command.ts`
- Modify: `apps/cli/src/commands/ui-command.ts`
- Modify: `apps/cli/test/args.unit.test.ts`
- Create: `apps/cli/test/ui-launch.unit.test.ts`
- Modify: `apps/core/src/admin/server.ts`
- Create: `apps/core/src/admin/bootstrap-destination.ts`
- Create: `apps/core/src/admin/static-files.ts`
- Create: `apps/core/test/admin-bootstrap-destination.security.test.ts`
- Create: `apps/core/test/admin-static-files.unit.test.ts`
- Modify: existing admin server integration test to cover bootstrap redirect behavior.
- Modify: `scripts/copy-static.mjs`
- Modify: `package.json`

**Interfaces:**
- `UiLaunch = 'none' | 'vanilla' | 'react'`.
- `parseAdminDestination(value): '/' | '/react/' | null` accepts only approved destinations.
- `resolveStaticAsset(staticDir, pathname)` safely resolves files/directories and maps `/react/` to `react/index.html`.

- [ ] **Step 1: Add failing CLI parser tests**

```ts
assert.deepEqual(parseAevraArgs(['start', '--ui']), {
  command: 'start',
  ui: 'vanilla',
});
assert.deepEqual(parseAevraArgs(['start', '--ui-react']), {
  command: 'start',
  ui: 'react',
});
assert.deepEqual(parseAevraArgs(['start']), {
  command: 'start',
  ui: 'none',
});
assert.throws(
  () => parseAevraArgs(['start', '--ui', '--ui-react']),
  /cannot be used together/i,
);
```

- [ ] **Step 2: Add failing safe-destination tests**

```ts
assert.equal(parseAdminDestination(undefined), '/');
assert.equal(parseAdminDestination('/'), '/');
assert.equal(parseAdminDestination('/react/'), '/react/');
assert.equal(parseAdminDestination('https://evil.example'), null);
assert.equal(parseAdminDestination('//evil.example'), null);
assert.equal(parseAdminDestination('/react/../../secret'), null);
```

Add an integration case proving invalid `next` returns 400 before bootstrap-token consumption.

- [ ] **Step 3: Add failing static resolver tests**

Using a temp tree with `index.html`, `react/index.html`, `react/assets/app.js`, assert:

```text
/ -> index.html
/react/ -> react/index.html
/react/assets/app.js -> react/assets/app.js
/../../secret -> null
```

- [ ] **Step 4: Implement CLI launch selection**

Change the start command to `ui: UiLaunch` and on daemon readiness:

```ts
if (command.ui === 'vanilla') {
  await openAuthenticatedUi(config, '/');
}
if (command.ui === 'react') {
  await openAuthenticatedUi(config, '/react/');
}
```

`openAuthenticatedUi()` opens:

```ts
const url = `${localAdminBase(config)}/auth/bootstrap?token=${encodeURIComponent(
  token,
)}&next=${encodeURIComponent(destination)}`;
```

Existing `aevra ui` calls the same helper with `/`.

- [ ] **Step 5: Implement safe bootstrap destination**

Validate `next` before consuming the token. Valid bootstrap sets the same cookie and redirects to the validated destination. Invalid destination returns JSON 400 and keeps the token unconsumed.

- [ ] **Step 6: Implement static directory indexing**

`static-files.ts` appends `index.html` for `/` and trailing-slash directory paths, requires the resolved file to remain inside `staticDir`, and maps MIME types exactly for `.html`, `.js`, `.css`, `.json`, `.svg`, `.png`, `.ico`, and `.map`.

- [ ] **Step 7: Update build order**

Set:

```json
{
  "build:core": "tsc -p tsconfig.build.json",
  "build:vanilla": "node scripts/check-web-syntax.mjs && node scripts/copy-static.mjs",
  "build:react": "vite build --config apps/web-react/vite.config.ts",
  "build": "npm run build:core && npm run build:vanilla && npm run build:react"
}
```

`copy-static.mjs` clears/copies `dist/apps/web` first. Vite then writes `dist/apps/web/react` with `emptyOutDir: false`.

- [ ] **Step 8: Run focused CLI/admin/build tests**

```bash
npm run test:unit
npm run test:integration
npm run typecheck
npm run build
```

Assert `dist/apps/web/index.html` and `dist/apps/web/react/index.html` exist.

- [ ] **Step 9: Commit**

```bash
git add apps/cli apps/core/src/admin apps/core/test scripts package.json
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
- Extend: `apps/web-react/src/app/App.test.tsx`
- Extend: `apps/web-react/src/features/dashboard/dashboard.test.tsx`
- Extend: `apps/web-react/src/features/requests/requests.test.tsx`
- Extend: feature tests created in Tasks 4-5 when their reachable branches are named by the coverage report.

**Interfaces:**
- Built-UI smoke tests use the same fixture responses and `data-surface-id` selectors for vanilla and React.
- `test:ui-parity` builds both UIs, serves `dist/apps/web`, intercepts `/api/**`, and runs one Chromium project.

- [ ] **Step 1: Add Playwright script/config**

```json
{
  "test:ui-parity": "npm run build && playwright test --config playwright.config.ts"
}
```

`playwright.config.ts` starts `node tests/ui-parity/static-server.mjs` on one fixed localhost test port and runs Chromium only.

- [ ] **Step 2: Create shared parity helper**

```ts
async function forEachUi(page, callback) {
  for (const [name, path] of [
    ['vanilla', '/'],
    ['react', '/react/'],
  ] as const) {
    await page.goto(path);
    await callback(name);
  }
}
```

Selectors use `data-surface-id`, never implementation-specific classes.

- [ ] **Step 3: Test navigation/page surfaces in both UIs**

For every `ADMIN_SURFACE.navigation` entry, click the matching nav control and assert the page root plus action IDs listed for that feature in `admin-surface.json`.

- [ ] **Step 4: Test Onboarding parity in both states**

Fixture `completed: false`: Onboarding precedes Runtime overview and Remote Access is its first child block.

Fixture `completed: true`: Onboarding is the final Dashboard section. Collapse it, allow one polling refresh to complete, and assert the section remains closed.

- [ ] **Step 5: Test Requests parity**

Non-critical fixture requires Deny, Run once, Allow this session, Always in workspace, Always globally, server presentation, and Saved matcher.

CRITICAL fixture requires Deny + Run once and absence of session/workspace/global buttons.

- [ ] **Step 6: Add exact high-value admin smoke flows**

The Playwright suite covers these flows once in vanilla and once in React:

```text
Permissions: search + Effect filter + Revoke
Workspaces: Details + Remove controls
Sessions: Workspace state filter + Revoke
Guide: Copy All
Settings: execution form save request
Processes: stop + restart controls
Changes: rollback control
Connections: create connector + one-time token presentation
```

- [ ] **Step 7: Close web coverage without blanket ignores**

```bash
npm run test:coverage:web
```

Extend only the named React/vanilla feature test files that own uncovered reachable branches. Repeat until lines/statements/functions/branches are each >=85.

- [ ] **Step 8: Run complete repository coverage**

```bash
npm run test:coverage
```

Expected: Node group and combined vanilla/React web group both meet all four >=85 thresholds.

- [ ] **Step 9: Run all final gates locally**

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

- [ ] **Step 10: Manual launch verification**

```bash
npm link
aevra start --ui-react
```

Verify authenticated React opens at `/react/` and shows the same stored Core state as vanilla. Stop Aevra, then run:

```bash
aevra start --ui
```

Verify vanilla opens at `/` with the same stored workspaces, permissions, sessions, settings, requests, and onboarding state.

- [ ] **Step 11: Verify source-policy and no-workflow constraints**

```bash
npm run lint:loc
npm run lint:deadcode
git ls-files '.github/workflows/*'
```

Expected: LOC/dead-code checks pass and workflow listing is empty.

- [ ] **Step 12: Commit final parity/coverage work**

```bash
git add -A
git commit -m "test: enforce vanilla react parity"
```

- [ ] **Step 13: Record final SHA and evidence**

```bash
git rev-parse HEAD
```

Use the printed SHA in the completion report together with exact outputs from format, lint, typecheck, test, coverage, parity smoke, and build commands.
