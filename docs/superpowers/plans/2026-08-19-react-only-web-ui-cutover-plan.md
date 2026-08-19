# React-only Web UI Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one responsive React + TypeScript admin UI at `/`, fix the Dashboard navigation race, apply the OpenCode-derived Aevra design system with persistent light/dark themes, and remove the vanilla UI plus `--ui-react` compatibility.

**Architecture:** React becomes the sole static application and Vite writes directly to `dist/apps/web`. Navigation uses synchronous React state plus `history.pushState`, with `popstate` handling browser history. Theme state is local-browser state applied through `data-theme` tokens. CLI/bootstrap/static routing expose only `/`, and all vanilla source/build/test compatibility is deleted after React coverage replaces it.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, React Testing Library, Playwright, Node test runner, CSS custom properties, existing Aevra Core/CLI/admin APIs.

**Spec:** `docs/superpowers/specs/2026-08-19-react-only-web-ui-design.md`

## Global Constraints

- Work directly on `main`; do not create a feature branch or worktree.
- React is the only shipped admin UI after this plan.
- `aevra start --ui` opens React at `/`.
- `aevra start --ui-react` is removed and must fail as an unknown option.
- `/react` and `/react/` are not compatibility application roots.
- Dashboard Runtime Overview must not contain a Version tile.
- Theme values are exactly `light | dark`; persist them locally and otherwise follow `prefers-color-scheme`.
- Theme toggle is immediately left of Requests in DOM and visual order.
- Page tabs remain horizontal and non-wrapping at desktop, tablet, and mobile widths.
- Do not bundle or redistribute Berkeley Mono; use the documented monospace fallback stack.
- No shadows or gradients in the application design system.
- Interactive radius is 4px; structural containers use 0px radius.
- Preserve backend APIs, permissions, approvals, onboarding semantics, Cloudflare behavior, Native host behavior, and MCP security.
- Keep source limits: `.ts` <= 350 lines, `.tsx` <= 400, `.js` <= 350, `.css` <= 500, including tests.
- Keep Prettier-readable source; no minification to satisfy LOC.
- Coverage remains >=85% for lines, statements, functions, and branches.
- Do not add `.github/workflows`.

---

### Task 1: Make React navigation race-free

**Files:**
- Modify: `apps/web-react/src/app/use-hash-page.ts`
- Modify: `apps/web-react/src/app/App.test.tsx`
- Modify: `tests/ui-parity/navigation.spec.ts` or replace it with a React-only navigation smoke test during Task 5

**Interfaces:**
- Consumes: `AdminPageId`, `ADMIN_SURFACE.navigation`.
- Produces: `useHashPage(): { page: AdminPageId; navigate(next: AdminPageId): void }` where `navigate` updates React state synchronously and writes history using `history.pushState`.

- [ ] **Step 1: Write the failing delayed-Dashboard regression**

Add a test to `App.test.tsx` that controls Dashboard fetch completion and asserts later completion cannot change the current page:

```tsx
test('stays on the second tab when Dashboard work finishes later', async () => {
  const user = userEvent.setup();
  let resolveDashboard!: (value: Response) => void;
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (url === '/api/dashboard/runtime') {
      return new Promise<Response>((resolve) => {
        resolveDashboard = resolve;
      });
    }
    return originalFetch(input, init);
  }));

  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Dashboard' }));
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();

  resolveDashboard(new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  await Promise.resolve();
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  expect(window.location.hash).toBe('#/settings');
});
```

Use the existing API fixture helper rather than the raw `originalFetch` fallback if needed; the invariant is delayed Dashboard completion after selecting Settings.

- [ ] **Step 2: Add Back/Forward coverage**

Add a focused hook/App test:

```tsx
test('uses popstate for browser history navigation', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Settings' }));
  await user.click(screen.getByRole('button', { name: 'Guide' }));
  history.back();
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the React test and verify RED**

Run:

```bash
npm --prefix apps/web-react test -- src/app/App.test.tsx
```

Expected: the delayed-navigation or Back/Forward test fails with the current hashchange-only navigation model.

- [ ] **Step 4: Implement synchronous navigation**

Change `use-hash-page.ts` to this shape:

```ts
export function useHashPage() {
  const [page, setPage] = useState<AdminPageId>(pageFromHash);

  useEffect(() => {
    const onPopState = () => setPage(pageFromHash());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (next: AdminPageId) => {
    const nextHash = `#/${next}`;
    if (page === next && window.location.hash === nextHash) return;
    setPage(next);
    history.pushState(null, '', nextHash);
  };

  return { page, navigate };
}
```

Do not register programmatic `hashchange` as a state transport.

- [ ] **Step 5: Run the focused test and verify GREEN**

```bash
npm --prefix apps/web-react test -- src/app/App.test.tsx
```

Expected: all App navigation tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web-react/src/app/use-hash-page.ts apps/web-react/src/app/App.test.tsx
git commit -m "fix: prevent dashboard navigation race"
```

---

### Task 2: Add persistent theme state and OpenCode-derived shell styling

**Files:**
- Create: `apps/web-react/src/hooks/use-theme.ts`
- Create: `apps/web-react/src/hooks/use-theme.test.tsx`
- Modify: `apps/web-react/src/components/AppShell.tsx`
- Modify: `apps/web-react/src/app/App.tsx`
- Create or reorganize: `apps/web-react/src/styles/tokens.css`
- Create or reorganize: `apps/web-react/src/styles/shell.css`
- Create or reorganize: `apps/web-react/src/styles/components.css`
- Create or reorganize: `apps/web-react/src/styles/dashboard.css`
- Create or reorganize: `apps/web-react/src/styles/admin.css`
- Create or reorganize: `apps/web-react/src/styles/requests.css`
- Modify: `apps/web-react/src/main.tsx`
- Modify: `apps/web-react/src/app/App.test.tsx`

**Interfaces:**
- Produces: `type Theme = 'light' | 'dark'`.
- Produces: `useTheme(): { theme: Theme; toggleTheme(): void }`.
- Storage key: `aevra.ui.theme.v1`.
- Root contract: `document.documentElement.dataset.theme = theme`.

- [ ] **Step 1: Write theme hook tests**

Create `use-theme.test.tsx` covering stored preference, OS fallback, persistence, and root attribute:

```tsx
function Probe() {
  const { theme, toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>{theme}</button>;
}

test('uses stored theme and persists toggles', async () => {
  localStorage.setItem('aevra.ui.theme.v1', 'light');
  const user = userEvent.setup();
  render(<Probe />);
  expect(screen.getByRole('button')).toHaveTextContent('light');
  expect(document.documentElement.dataset.theme).toBe('light');
  await user.click(screen.getByRole('button'));
  expect(localStorage.getItem('aevra.ui.theme.v1')).toBe('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
});
```

Also mock `matchMedia('(prefers-color-scheme: dark)')` and verify dark fallback when storage is empty.

- [ ] **Step 2: Run theme tests and verify RED**

```bash
npm --prefix apps/web-react test -- src/hooks/use-theme.test.tsx
```

Expected: FAIL because `use-theme.ts` does not exist.

- [ ] **Step 3: Implement `useTheme`**

Use lazy state initialization and one effect:

```ts
export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'aevra.ui.theme.v1';

function initialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);
  return {
    theme,
    toggleTheme: () => setTheme((current) => current === 'dark' ? 'light' : 'dark'),
  };
}
```

- [ ] **Step 4: Put the theme toggle immediately before Requests**

Pass `theme` and `onToggleTheme` from `App` into `AppShell` and render:

```tsx
<button
  type="button"
  className="theme-toggle"
  aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
  onClick={onToggleTheme}
>
  [{theme}]
</button>
<button id="open-requests">...</button>
```

Do not use an SVG icon.

- [ ] **Step 5: Add shell placement regression**

In `App.test.tsx`, assert DOM order:

```tsx
const themeButton = screen.getByRole('button', { name: /Switch to .* mode/ });
const requestsButton = screen.getByRole('button', { name: /Requests/ });
expect(themeButton.compareDocumentPosition(requestsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

- [ ] **Step 6: Move the OpenCode-derived tokens into React-owned CSS**

Define light defaults and dark overrides in `tokens.css`:

```css
:root,
:root[data-theme="light"] {
  color-scheme: light;
  --canvas: #fdfcfc;
  --surface-soft: #f8f7f7;
  --surface-card: #f1eeee;
  --ink: #201d1d;
  --body: #424245;
  --mute: #646262;
  --ash: #9a9898;
  --hairline: rgb(15 0 0 / 12%);
  --hairline-strong: #646262;
  --accent: #007aff;
  --warning: #ff9f0a;
  --danger: #ff3b30;
  --success: #30d158;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #171515;
  --surface-soft: #1e1b1b;
  --surface-card: #292525;
  --ink: #fdfcfc;
  --body: #d5d1d1;
  --mute: #aaa5a5;
  --ash: #747070;
  --hairline: rgb(253 252 252 / 14%);
  --hairline-strong: #646262;
  --accent: #0a84ff;
  --warning: #ff9f0a;
  --danger: #ff453a;
  --success: #32d74b;
}
```

Use the exact monospace stack from `apps/web-react/design.md`. Structural containers use `border-radius: 0`; buttons/inputs/selects/textarea use `4px`; remove all box shadows and gradients.

- [ ] **Step 7: Import only React-owned CSS from `main.tsx`**

Remove imports that point into `apps/web/styles`. Import React-local CSS files instead.

- [ ] **Step 8: Run theme/App tests**

```bash
npm --prefix apps/web-react test -- src/hooks/use-theme.test.tsx src/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web-react/src
git commit -m "feat: add persistent Aevra themes"
```

---

### Task 3: Make the React UI responsive and remove the Runtime Version tile

**Files:**
- Modify: `apps/web-react/src/features/dashboard/DashboardPage.tsx`
- Modify: `apps/web-react/src/features/dashboard/DashboardPage.test.tsx`
- Modify: React-owned CSS files from Task 2
- Modify: `apps/web-react/src/components/DataTable.tsx`
- Modify: `apps/web-react/src/components/DataTable.test.tsx`
- Modify: `apps/web-react/src/features/requests/RequestDrawer.tsx`
- Add/modify: `tests/ui-parity/responsive.spec.ts` during Task 5 after the suite becomes React-only

**Interfaces:**
- Runtime Overview shows operational metrics only.
- Top nav remains `flex-wrap: nowrap; overflow-x: auto` at every breakpoint.
- Mobile/tablet layouts must not introduce page-level horizontal overflow.

- [ ] **Step 1: Add a Runtime Overview test that rejects Version**

```tsx
render(<DashboardPage />);
expect(await screen.findByText('Remote sessions')).toBeInTheDocument();
expect(screen.queryByText('Version')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the Dashboard test and verify RED**

```bash
npm --prefix apps/web-react test -- src/features/dashboard/DashboardPage.test.tsx
```

Expected: FAIL because Runtime Overview currently includes `['Version', ...]`.

- [ ] **Step 3: Remove only the Version row**

Delete the Version tuple from `RuntimeOverview`; leave header version/status unchanged.

- [ ] **Step 4: Add responsive CSS contracts**

Implement these concrete behaviors:

```css
.top-nav {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  white-space: nowrap;
}

@media (max-width: 1023px) {
  .settings-grid,
  .onboarding-body,
  .client-grid,
  .remote-config-grid {
    grid-template-columns: 1fr;
  }
  .health-cluster { display: none; }
}

@media (max-width: 640px) {
  .page { padding: 12px; }
  .topbar { padding-inline: 12px; gap: 8px; }
  .topbar-actions { gap: 4px; }
  .theme-toggle,
  #open-requests { min-height: 40px; }
  .request-drawer { width: 100vw; max-width: 100vw; }
  .form-row { grid-template-columns: 1fr; }
}
```

For table overflow, keep controls visible and either make the table viewport horizontally scrollable or use the existing responsive DataTable row layout. Do not hide columns automatically without a user-facing control.

- [ ] **Step 5: Add DataTable small-viewport contract**

In `DataTable.test.tsx`, assert the wrapper class used for horizontal overflow remains present and actions remain rendered with narrow-container class/style conditions.

- [ ] **Step 6: Run focused component tests**

```bash
npm --prefix apps/web-react test -- src/features/dashboard/DashboardPage.test.tsx src/components/DataTable.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web-react/src/features/dashboard apps/web-react/src/components apps/web-react/src/styles
git commit -m "style: make React admin responsive"
```

---

### Task 4: Cut build/static/bootstrap routing to React-only `/`

**Files:**
- Modify: `apps/web-react/vite.config.ts`
- Modify: `apps/core/src/admin/bootstrap-destination.ts`
- Modify: `apps/core/src/admin/static-files.ts`
- Modify: `apps/core/test/admin-bootstrap-destination.unit.test.ts`
- Modify: `apps/core/test/admin-static-files.unit.test.ts`
- Modify: `apps/core/test/admin-server-static.integration.test.ts`
- Modify: `scripts/copy-static.mjs` or replace with a manual-only copier
- Modify: `package.json`
- Modify: `scripts/test/web-build-script.test.mjs`

**Interfaces:**
- Vite: `base: '/'` and `outDir: '../../dist/apps/web'`.
- `parseAdminDestination(undefined | '/')` returns `'/'`; `/react` and `/react/` return `null`.
- `resolveStaticAsset(root, '/')` resolves `root/index.html`.

- [ ] **Step 1: Change bootstrap destination tests to React-only**

```ts
assert.equal(parseAdminDestination(undefined), '/');
assert.equal(parseAdminDestination('/'), '/');
assert.equal(parseAdminDestination('/react'), null);
assert.equal(parseAdminDestination('/react/'), null);
assert.equal(parseAdminDestination('https://evil.test'), null);
```

- [ ] **Step 2: Change static resolver tests**

Assert `/` maps to `index.html`, asset paths map below the root, traversal is rejected, and `/react/` no longer maps specially to a React index.

- [ ] **Step 3: Run Core focused tests and verify RED**

```bash
node scripts/run-ts-tests.mjs apps/core/test/admin-bootstrap-destination.unit.test.ts apps/core/test/admin-static-files.unit.test.ts apps/core/test/admin-server-static.integration.test.ts
```

Expected: failures for retained `/react/` compatibility.

- [ ] **Step 4: Implement single destination/static root**

`bootstrap-destination.ts` becomes:

```ts
export type AdminDestination = '/';
export function parseAdminDestination(value: string | undefined): AdminDestination | null {
  return value === undefined || value === '/' ? '/' : null;
}
```

Remove `/react` special handling from `static-files.ts`.

- [ ] **Step 5: Change Vite root/output**

```ts
export default defineConfig({
  base: '/',
  // existing plugin/alias/test config
  build: {
    outDir: '../../dist/apps/web',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 6: Preserve user manual assets without restoring vanilla copy**

Replace `scripts/copy-static.mjs` with a focused script such as `scripts/copy-manual.mjs` that only copies `docs/user-manual` to `dist/apps/web/manual` **after** the React Vite build. It must not copy `apps/web`.

- [ ] **Step 7: Update root build order**

Use:

```json
"build": "tsc -p tsconfig.build.json --noCheck && npm --prefix apps/web-react run build && node scripts/copy-manual.mjs"
```

Remove the vanilla JS syntax-copy stage.

- [ ] **Step 8: Run focused build-contract tests**

```bash
node --test scripts/test/web-build-script.test.mjs
```

Expected: PASS with root React Vite output and no vanilla copy.

- [ ] **Step 9: Commit**

```bash
git add apps/web-react/vite.config.ts apps/core/src/admin apps/core/test scripts package.json
git commit -m "build: serve React admin at root"
```

---

### Task 5: Remove `--ui-react`, vanilla UI, and dual-surface tests

**Files:**
- Modify: `apps/cli/src/args.ts`
- Modify: `apps/cli/src/cli-support.ts`
- Modify: CLI completion/help tests that mention `--ui-react`
- Modify: `apps/cli/test/args.unit.test.ts`
- Modify: `apps/cli/test/start-command.unit.test.ts`
- Modify: user manual/README references to `--ui-react`
- Delete: entire `apps/web/` tree
- Delete/replace: vanilla source-contract tests under `scripts/test/`
- Modify: `tests/ui-parity/fixtures.ts`
- Modify: `tests/ui-parity/navigation.spec.ts`
- Modify: other `tests/ui-parity/*.spec.ts` to target one React surface
- Create: `tests/ui-parity/responsive.spec.ts`
- Modify: `package.json`
- Modify: Knip config if it lists vanilla entry files

**Interfaces:**
- `AdminUiDestination` no longer represents multiple destinations; simplify start command state to `openUi: boolean` or keep a single `'/'` constant private to CLI dependencies.
- `aevra start --ui` opens `/`.
- `aevra start --ui-react` throws `Unknown option: --ui-react`.

- [ ] **Step 1: Write CLI RED tests**

```ts
assert.deepEqual(parseAevraArgs(['start', '--ui']), {
  command: 'start',
  openUi: true,
});
assert.throws(
  () => parseAevraArgs(['start', '--ui-react']),
  /Unknown option: --ui-react/,
);
```

If the chosen final property stays `uiDestination`, make it `uiDestination: '/' | null`; do not retain a `/react/` union.

- [ ] **Step 2: Run CLI tests and verify RED**

```bash
node scripts/run-ts-tests.mjs apps/cli/test/args.unit.test.ts apps/cli/test/start-command.unit.test.ts
```

Expected: FAIL because `--ui-react` is still recognized.

- [ ] **Step 3: Remove `--ui-react` from parser/help/completion**

Only `--ui` remains under `start`.

- [ ] **Step 4: Delete vanilla source**

Delete every tracked file beneath `apps/web/`. Do not leave redirect/index compatibility files.

- [ ] **Step 5: Replace dual-surface parity fixtures**

Change the Playwright surface source from vanilla+React to a single application root:

```ts
export const ADMIN_SURFACE = { name: 'react', path: '/' } as const;
```

Remove loops whose only purpose was comparing two implementations. Keep the high-value browser workflows as React smoke/regression coverage.

- [ ] **Step 6: Add responsive browser tests**

Create `responsive.spec.ts`:

```ts
for (const viewport of [
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name} keeps tabs horizontal and core actions reachable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installAdminApi(page);
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Aevra admin' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Switch to .* mode/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Requests/ })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
}
```

Add an assertion with `page.evaluate` that `document.documentElement.scrollWidth <= document.documentElement.clientWidth` after representative pages load; exempt dedicated table scroll containers, not the page itself.

- [ ] **Step 7: Rewrite root web contract scripts**

Remove `web-modular-entry`, `web-modular-surface`, vanilla-only source tests, and `admin-surface-parity` assertions that require `apps/web`. Keep React architecture/design/build contracts.

- [ ] **Step 8: Run CLI + source contracts**

```bash
node scripts/run-ts-tests.mjs apps/cli/test/args.unit.test.ts apps/cli/test/start-command.unit.test.ts
npm run test:web:contracts
```

Expected: PASS with no vanilla or `--ui-react` references.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: remove vanilla admin UI"
```

---

### Task 6: Lock design, theme, race, and React-only behavior with browser coverage

**Files:**
- Modify: `scripts/test/react-ui-source.test.mjs`
- Create: `scripts/test/react-only-ui.test.mjs`
- Modify: `tests/ui-parity/navigation.spec.ts`
- Modify: `tests/ui-parity/dashboard.spec.ts`
- Create: `tests/ui-parity/theme.spec.ts`
- Modify: `playwright.config.ts` if the static server assumes `/react/`
- Modify: `package.json`

**Interfaces:**
- Source contract rejects `apps/web`, `/react/`, and `--ui-react` runtime/build references.
- Browser contract proves theme persistence and Dashboard race in the built React app.

- [ ] **Step 1: Add React-only source contract**

Create `react-only-ui.test.mjs` that checks:

```js
assert.equal(existsSync('apps/web'), false);
assert.match(readFileSync('apps/web-react/vite.config.ts', 'utf8'), /base:\s*['"]\/['"]/);
assert.doesNotMatch(readFileSync('apps/cli/src/args.ts', 'utf8'), /--ui-react|\/react\//);
assert.doesNotMatch(readFileSync('apps/core/src/admin/bootstrap-destination.ts', 'utf8'), /\/react/);
```

Also assert `apps/web-react/design.md` exists and contains `no shadows`, horizontal navigation, light/dark tokens, and the proprietary-font prohibition.

- [ ] **Step 2: Add theme browser test**

```ts
test('theme toggle persists without changing the active tab', async ({ page }) => {
  await installAdminApi(page);
  await page.goto('/#/settings');
  const toggle = page.getByRole('button', { name: /Switch to .* mode/ });
  const before = await page.locator('html').getAttribute('data-theme');
  await toggle.click();
  const after = await page.locator('html').getAttribute('data-theme');
  expect(after).not.toBe(before);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', after!);
});
```

- [ ] **Step 3: Add built-app Dashboard race test**

Intercept `/api/dashboard/runtime`, delay one response, navigate `Dashboard -> Settings` immediately, release the delayed response, wait beyond the polling interval, and assert Settings remains selected and visible.

- [ ] **Step 4: Run browser suite**

```bash
npm run test:ui-parity
```

Expected: PASS; despite the legacy script name, it now means React UI browser regression coverage. Rename it to `test:ui` if desired, but update every package/prepublish reference atomically.

- [ ] **Step 5: Commit**

```bash
git add scripts/test tests/ui-parity playwright.config.ts package.json
git commit -m "test: lock React-only admin behavior"
```

---

### Task 7: Final quality gate and dead-code cleanup

**Files:**
- Modify only files identified by Prettier, LOC, Knip, typecheck, tests, coverage, or build failures.
- Modify: `package-lock.json` through `npm install` when registry access is available.
- Verify: `.github/workflows` remains absent.

**Interfaces:**
- Final standard command set is green.
- No tracked vanilla UI, `/react/` app compatibility, or `--ui-react` remains.

- [ ] **Step 1: Install and refresh lockfile**

```bash
npm install
```

Expected: root/workspace dependencies resolve and `package-lock.json` represents the React workspace plus test/quality dependencies.

- [ ] **Step 2: Format**

```bash
npm run format
npm run format:check
```

Expected: both commands exit 0.

- [ ] **Step 3: Enforce LOC and dead code**

```bash
npm run lint
```

Expected: source/security lint, LOC limits, and Knip all exit 0. If any touched file exceeds its cap, split by responsibility rather than compressing formatting.

- [ ] **Step 4: Run semantic typecheck**

```bash
npm run typecheck
```

Expected: exit 0 with React, CLI, Core, and tests type-correct.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: exit 0.

- [ ] **Step 6: Run four-metric coverage gate**

```bash
npm run test:coverage
```

Expected: lines >=85%, statements >=85%, functions >=85%, branches >=85%.

- [ ] **Step 7: Run browser regressions**

```bash
npm run test:ui-parity
```

Expected: exit 0 for navigation race, Back/Forward, theme persistence, Dashboard behavior, admin flows, tablet, and mobile.

- [ ] **Step 8: Build publishable output**

```bash
npm run build
```

Expected: `dist/apps/web/index.html` is the React app, manual assets remain available, and there is no `dist/apps/web/react` application root.

- [ ] **Step 9: Verify forbidden compatibility and workflow state**

```bash
git grep -n -E 'ui-react|/react/' -- ':!docs/superpowers/**' ':!CHANGELOG.md'
test ! -d apps/web
test ! -d .github/workflows
```

Expected: grep has no active runtime/build/docs hits that preserve the old compatibility, `apps/web` does not exist, and `.github/workflows` does not exist.

- [ ] **Step 10: Commit verification-only fixes and lockfile**

```bash
git add -A
git commit -m "chore: finalize React-only admin cutover"
```
