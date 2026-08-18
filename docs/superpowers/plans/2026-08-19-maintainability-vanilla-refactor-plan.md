# Maintainability and Vanilla Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing vanilla Aevra UI obey the approved onboarding behavior while converting the repository to readable Prettier-formatted source, hard LOC budgets, semantic type checking, dead-code detection, and >=85% coverage before the React UI is introduced.

**Architecture:** Preserve the current Core/API/auth behavior while first locking behavior with tests, then installing quality gates, then splitting the known monoliths by responsibility. Vanilla browser code moves from layered global scripts into ES modules with focused page/component/service files; Core admin routing, CLI dispatch, and MCP tool orchestration are split behind stable interfaces.

**Tech Stack:** Node.js >=22.5, TypeScript, Node test runner, Vitest + jsdom for browser modules, c8 for Node coverage, Prettier, Knip, existing static admin server.

**Spec:** `docs/superpowers/specs/2026-08-19-react-ui-maintainability-refactor-design.md`

## Global Constraints

- Target branch is `main`.
- Keep the vanilla UI available through `aevra start --ui`.
- Remote Access must be the first block inside Onboarding.
- Before completion, Onboarding is near the top and initially expanded.
- After completion, the whole Onboarding panel moves to the Dashboard bottom and periodic refresh must not force it open.
- All maintained source must be normal readable Prettier output; minification/compression to reduce LOC is forbidden.
- LOC limits apply to every tracked maintained file, including tests: `.ts` <=350, `.tsx` <=400, `.js` <=350, `.css` <=500.
- Generated/vendor output such as `dist/`, `node_modules/`, coverage, test build output, and explicitly vendored/generated files is excluded.
- Maintained executable TS/JS must reach >=85% lines, statements, functions, and branches.
- Do not add GitHub Actions or other CI workflows.
- Keep existing security behavior: no authorization, approval, workspace-containment, DLP, audit, or command-policy weakening.

---

### Task 1: Lock the approved vanilla Onboarding + Remote Access behavior

**Files:**
- Modify: `scripts/test/web-dashboard-v2.test.mjs`
- Modify: `scripts/test/web-dashboard-v3.test.mjs`
- Modify: `apps/web/app-v2.js`
- Modify: `apps/web/app-v3.js`

**Interfaces:**
- Consumes: existing `/api/onboarding`, `/api/cloudflare/status`, Dashboard rendering, `remoteAccessMarkup()`.
- Produces: vanilla Dashboard behavior that later refactoring must preserve.

- [ ] **Step 1: Add failing source-contract tests for containment and ordering**

Add assertions equivalent to:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const v2 = readFileSync('apps/web/app-v2.js', 'utf8');

test('Remote Access is rendered inside Onboarding before Connect an AI', () => {
  const onboardingStart = v2.indexOf('class="onboarding-body"');
  const remote = v2.indexOf('Remote Access', onboardingStart);
  const connect = v2.indexOf('Connect an AI', onboardingStart);
  assert.ok(onboardingStart >= 0);
  assert.ok(remote > onboardingStart);
  assert.ok(connect > remote);
});

test('completed onboarding is rendered after runtime/activity content', () => {
  assert.match(v2, /onboarding\.completed\s*\?[^;]*dashboard-bottom/);
  assert.doesNotMatch(v2, /Remote Access remains visible above this section/);
});
```

In the v3 regression, assert there is no code that reparents Remote Access outside Onboarding and no refresh path that unconditionally reopens an already initialized Onboarding panel.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test scripts/test/web-dashboard-v2.test.mjs scripts/test/web-dashboard-v3.test.mjs
```

Expected: at least the containment/order assertion fails because `app-v2.js` currently emits Remote Access before the `<details class="onboarding-panel">` block.

- [ ] **Step 3: Implement the minimum vanilla behavior change**

In `renderDashboard()`:

```js
const onboardingMarkup = `<details class="onboarding-panel" data-dashboard-section="onboarding">
  <summary>...</summary>
  <div class="onboarding-body">
    <section class="onboarding-block wide" data-onboarding-section="remote-access">
      <div class="section-heading"><span>Remote Access</span><strong>${cf.hostname ? 'Configured' : 'Setup needed'}</strong></div>
      ${remoteAccessMarkup(cf, 'dashboard')}
    </section>
    ...existing Connect an AI / Workspace / Try Aevra / Finish blocks...
  </div>
</details>`;

const primaryMarkup = `${runtimeOverview}${toolActivity}${connections}${recentActivity}`;
el.innerHTML = onboarding.completed
  ? `${primaryMarkup}<div class="dashboard-bottom">${onboardingMarkup}</div>`
  : `${onboardingMarkup}${primaryMarkup}`;
```

Remove the stale sentence that says Remote Access remains above Onboarding. Keep `wireRemoteAccess()` bound against the whole Dashboard element so the moved form retains all existing actions.

In `app-v3.js`, preserve user collapse state by only setting `onboarding.open = true` when the element has not yet been initialized:

```js
if (!onboarding.dataset.dashboardInitialized) {
  onboarding.dataset.dashboardInitialized = 'true';
  onboarding.open = true;
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same command. Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app-v2.js apps/web/app-v3.js scripts/test/web-dashboard-v2.test.mjs scripts/test/web-dashboard-v3.test.mjs
git commit -m "fix: keep remote access inside onboarding"
```

---

### Task 2: Install real formatting, LOC, semantic typecheck, dead-code, and coverage tooling

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.prettierignore`
- Create: `.prettierrc.json`
- Modify: `scripts/format-check.mjs`
- Modify: `scripts/lint.mjs`
- Create: `scripts/lib/source-policy.mjs`
- Create: `scripts/loc-lint.mjs`
- Create: `scripts/test/source-policy.test.mjs`
- Create: `scripts/test/package-quality-scripts.test.mjs`
- Create: `knip.json`
- Create: `tsconfig.typecheck.json`
- Create: `tsconfig.test.json`
- Create: `vitest.web.config.ts`
- Create: `scripts/test-coverage-node.mjs`

**Interfaces:**
- Produces scripts: `format`, `format:check`, `lint`, `lint:loc`, `lint:deadcode`, `typecheck`, `test:coverage:node`, `test:coverage:web`, `test:coverage`.
- Produces `sourceLimit(path): number | null`, `countPhysicalLines(text): number`, and `looksArtificiallyCompressed(text): boolean` from `scripts/lib/source-policy.mjs`.

- [ ] **Step 1: Add failing tests for source policy and package scripts**

`source-policy.test.mjs` must assert:

```js
assert.equal(sourceLimit('apps/core/src/runtime.ts'), 350);
assert.equal(sourceLimit('apps/web-react/src/App.tsx'), 400);
assert.equal(sourceLimit('apps/web/main.js'), 350);
assert.equal(sourceLimit('apps/web/styles/base.css'), 500);
assert.equal(sourceLimit('dist/apps/web/app.js'), null);
assert.equal(sourceLimit('node_modules/x/index.js'), null);
assert.equal(countPhysicalLines('a\nb\n'), 2);
assert.equal(looksArtificiallyCompressed('const a=1;const b=2;const c=3;'.repeat(30)), true);
```

`package-quality-scripts.test.mjs` must parse `package.json` and require every script name above, and require `format:check` to contain `prettier --check`.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test scripts/test/source-policy.test.mjs scripts/test/package-quality-scripts.test.mjs
```

Expected: module/scripts are missing.

- [ ] **Step 3: Install dev dependencies and update the lockfile**

```bash
npm install --save-dev prettier knip c8 vitest jsdom @vitest/coverage-v8 @types/node
```

Do not hand-edit `package-lock.json`; let npm generate it.

- [ ] **Step 4: Implement source-policy helpers**

Use this API:

```js
const LIMITS = new Map([
  ['.ts', 350],
  ['.tsx', 400],
  ['.js', 350],
  ['.css', 500],
]);

const EXCLUDED_SEGMENTS = new Set([
  'dist',
  'node_modules',
  'coverage',
  '.test-dist',
  '.coverage-dist',
]);

export function sourceLimit(file) {
  const normalized = file.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => EXCLUDED_SEGMENTS.has(part))) return null;
  return LIMITS.get(path.extname(normalized)) ?? null;
}

export function countPhysicalLines(text) {
  if (text.length === 0) return 0;
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

export function looksArtificiallyCompressed(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.some((line) => line.length > 500 && (line.match(/[;{}]/g) ?? []).length >= 20);
}
```

`loc-lint.mjs` must obtain tracked files with:

```js
spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
```

For every tracked maintained source file: fail if `looksArtificiallyCompressed()` is true or line count exceeds the extension limit. Print `path: N lines (limit M)` for each failure.

- [ ] **Step 5: Replace newline-only formatting with real Prettier**

Set scripts:

```json
{
  "format": "prettier --write .",
  "format:check": "prettier --check . && node scripts/format-check.mjs",
  "lint:loc": "node scripts/loc-lint.mjs",
  "lint:deadcode": "knip",
  "lint": "node scripts/lint.mjs && npm run lint:loc && npm run lint:deadcode",
  "typecheck": "tsc -p tsconfig.typecheck.json --noEmit",
  "test:coverage:node": "node scripts/test-coverage-node.mjs",
  "test:coverage:web": "vitest run --config vitest.web.config.ts --coverage",
  "test:coverage": "npm run test:coverage:node && npm run test:coverage:web"
}
```

Keep `scripts/format-check.mjs` as the CRLF/final-newline supplemental check; Prettier becomes the canonical formatter.

Extend `.prettierignore` with:

```text
coverage
.test-dist
.coverage-dist
```

- [ ] **Step 6: Add semantic TypeScript configs**

`tsconfig.typecheck.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noCheck": false,
    "noEmit": true,
    "types": ["node"],
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "exclude": ["dist", ".test-dist", ".coverage-dist", "apps/web-react"]
}
```

`tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.typecheck.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": ".coverage-dist",
    "sourceMap": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false
  }
}
```

- [ ] **Step 7: Add Node coverage runner**

`test-coverage-node.mjs` must compile with `tsc -p tsconfig.test.json`, collect compiled production/test JS under `.coverage-dist/apps`, `.coverage-dist/packages`, and `.coverage-dist/tests`, then spawn c8 with:

```text
--check-coverage --lines 85 --statements 85 --functions 85 --branches 85
--all
--exclude **/*.test.js
--exclude **/test/**
```

and run `node --test` over compiled test files. Exit with the child status.

- [ ] **Step 8: Add Knip entry configuration**

`knip.json` must identify dynamic application entry points so valid runtime code is not reported dead:

```json
{
  "entry": [
    "apps/cli/src/cli.ts",
    "apps/core/src/main.ts",
    "apps/worker/src/main.ts",
    "packages/mcp-tools/src/register.ts",
    "scripts/*.mjs",
    "scripts/test/*.test.mjs"
  ],
  "project": ["apps/**/*.ts", "packages/**/*.ts", "scripts/**/*.mjs"],
  "ignore": ["dist/**", ".test-dist/**", ".coverage-dist/**", "coverage/**"]
}
```

- [ ] **Step 9: Run focused tests and tooling contracts**

```bash
node --test scripts/test/source-policy.test.mjs scripts/test/package-quality-scripts.test.mjs
npm run format:check
```

Expected: helper/script tests pass. `lint:loc` is expected to fail until Tasks 3-6 split current monoliths.

- [ ] **Step 10: Commit tooling**

```bash
git add package.json package-lock.json .prettierrc.json .prettierignore scripts knip.json tsconfig.typecheck.json tsconfig.test.json vitest.web.config.ts
git commit -m "build: add repository quality gates"
```

---

### Task 3: Prettier-format maintained source and freeze the real LOC inventory

**Files:**
- Modify: all tracked maintained source matched by Prettier, especially `apps/**/*.ts`, `packages/**/*.ts`, `apps/web/**/*.js`, `apps/web/**/*.css`, and tests.
- Create: `docs/superpowers/plans/2026-08-19-loc-inventory.txt`

**Interfaces:**
- Consumes: Task 2 formatting/LOC scripts.
- Produces: readable baseline source and an exact checked-in snapshot of violations before structural splitting.

- [ ] **Step 1: Format source**

```bash
npm run format
```

Do not manually collapse output after Prettier.

- [ ] **Step 2: Capture LOC failures**

```bash
npm run lint:loc > docs/superpowers/plans/2026-08-19-loc-inventory.txt 2>&1
```

Expected at this point: non-zero status because known monoliths exceed their limits.

- [ ] **Step 3: Assert known hotspots appear in the inventory**

The inventory must include any still-oversized members of this known set after formatting:

```text
apps/web/app.js
apps/web/app-v2.js
apps/web/app-v3.js
apps/web/ui-runtime.js
apps/web/admin-enhancements.js
apps/core/src/admin/routes/api.ts
apps/cli/src/cli.ts
packages/mcp-tools/src/service.ts
```

If one is below its limit after formatting, leave it intact unless another responsibility-based refactor task explicitly replaces it.

- [ ] **Step 4: Run current regression suite before structural moves**

```bash
npm test
npm run test:web
```

Expected: 0 failures. If formatting changes behavior, fix that before any extraction.

- [ ] **Step 5: Commit the formatting-only baseline separately**

```bash
git add -A
git commit -m "style: format maintained source with prettier"
```

---

### Task 4: Split CLI dispatch into command handlers under the TS LOC limit

**Files:**
- Modify: `apps/cli/src/cli.ts`
- Create: `apps/cli/src/admin-session.ts`
- Create: `apps/cli/src/commands/start-command.ts`
- Create: `apps/cli/src/commands/ui-command.ts`
- Create: `apps/cli/src/commands/setup-command.ts`
- Create: `apps/cli/src/commands/status-command.ts`
- Create: `apps/cli/src/commands/backup-command.ts`
- Create: `apps/cli/src/commands/maintenance-command.ts`
- Create: `apps/cli/src/commands/connectors-command.ts`
- Create: `apps/cli/src/commands/service-command.ts`
- Modify/add focused tests under: `apps/cli/test/`

**Interfaces:**
- `adminSession(config): Promise<{ adminApi(path, init?): Promise<Response>; openUi(destination?: '/'): Promise<void> }>`
- Each command module exports `runXCommand(command, context): Promise<number>`.
- `cli.ts` owns only argument parsing, common config creation, dispatch, and process exit behavior.

- [ ] **Step 1: Add dispatch regression tests**

Extend/create tests to verify each parsed command delegates once and returns its handler exit code. Example:

```ts
test('start dispatch delegates to runStartCommand', async () => {
  const calls: string[] = [];
  const code = await dispatchCommand(
    { command: 'start', ui: true },
    fakeContext({ runStartCommand: async () => (calls.push('start'), 0) }),
  );
  assert.deepEqual(calls, ['start']);
  assert.equal(code, 0);
});
```

- [ ] **Step 2: Run CLI tests and verify RED**

```bash
npm run test:unit -- --test-name-pattern=dispatch
```

If the custom test script does not forward test-name arguments, run the compiled/full CLI unit suite instead:

```bash
npm run test:unit
```

Expected: missing `dispatchCommand`/handler seams.

- [ ] **Step 3: Extract admin-session helpers**

Move `localControl`, authenticated bootstrap cookie creation, `adminApi`, `openBrowser`, and `openAuthenticatedUi` from `cli.ts` into `admin-session.ts`. Keep the UI destination fixed to `/` in this plan; React destination is added in Plan 2.

- [ ] **Step 4: Extract command handlers**

Each handler accepts explicit dependencies rather than importing mutable globals. Example shape:

```ts
export interface CliCommandContext {
  config: ReturnType<typeof loadCoreConfig>;
  console: Pick<Console, 'log' | 'error'>;
}

export async function runStatusCommand(
  command: Extract<AevraCommand, { command: 'status' }>,
  context: CliCommandContext,
): Promise<number> {
  // existing status logic
}
```

Keep setup-specific readline/Cloudflare dependencies in `setup-command.ts`; backup DB logic in `backup-command.ts`; audit/session maintenance together in `maintenance-command.ts`; service adapter logic in `service-command.ts`.

- [ ] **Step 5: Make `cli.ts` a thin dispatcher**

Target shape:

```ts
export async function dispatchCommand(command: AevraCommand, context: CliContext): Promise<number> {
  switch (command.command) {
    case 'help': return context.runHelp(command);
    case 'start': return context.runStart(command);
    case 'ui': return context.runUi(command);
    case 'setup': return context.runSetup(command);
    case 'status': return context.runStatus(command);
    case 'backup': return context.runBackup(command);
    case 'audit':
    case 'sessions': return context.runMaintenance(command);
    case 'connectors': return context.runConnectors(command);
    case 'completion': return context.runCompletion(command);
    case 'service': return context.runService(command);
  }
}
```

`main()` parses args, constructs the real context, then calls `dispatchCommand()`.

- [ ] **Step 6: Verify behavior and LOC**

```bash
npm run test:unit
npm run lint:loc
```

Expected: all CLI tests pass and every new/modified `.ts` file is <=350 lines.

- [ ] **Step 7: Commit**

```bash
git add apps/cli
git commit -m "refactor: split cli command handlers"
```

---

### Task 5: Split Core admin routing and MCP tool orchestration

**Files:**
- Modify: `apps/core/src/admin/routes/api.ts`
- Create: `apps/core/src/admin/routes/types.ts`
- Create: `apps/core/src/admin/routes/request-body.ts`
- Create: `apps/core/src/admin/routes/workspace-routes.ts`
- Create: `apps/core/src/admin/routes/permission-routes.ts`
- Create: `apps/core/src/admin/routes/approval-routes.ts`
- Create: `apps/core/src/admin/routes/session-routes.ts`
- Create: `apps/core/src/admin/routes/connector-routes.ts`
- Create: `apps/core/src/admin/routes/settings-routes.ts`
- Create: `apps/core/src/admin/routes/audit-routes.ts`
- Create: `apps/core/src/admin/routes/execution-routes.ts`
- Modify: `packages/mcp-tools/src/service.ts`
- Create: `packages/mcp-tools/src/service-types.ts`
- Create: `packages/mcp-tools/src/file-tools.ts`
- Create: `packages/mcp-tools/src/command-tools.ts`
- Create: `packages/mcp-tools/src/git-tools.ts`
- Create: `packages/mcp-tools/src/process-tools.ts`
- Create/modify tests under: `apps/core/test/`, `packages/mcp-tools/test/`

**Interfaces:**
- `AdminRouteHandler = (req, res, url, context) => Promise<boolean>`; returning `true` means the route handled the request.
- `handleAdminApi()` becomes an ordered dispatcher over route handlers.
- `ToolExecutionContext` holds the dependencies currently captured by `McpToolService` helper methods; extracted tool functions receive it explicitly and preserve existing return/error contracts.

- [ ] **Step 1: Add route-dispatch tests before extraction**

Test that a known workspace route, permission route, approval route, settings route, and unknown route preserve status/body behavior. Use the existing Admin API integration harness; do not mock away authorization/session checks.

- [ ] **Step 2: Add MCP orchestration regression tests before extraction**

Cover at least:

```text
file_read
file_write exact capability approval
command_run matcher-specific approval
shell_run risk floor
process_start host matcher
approval resume once
critical command persistence rejection
```

Use existing `packages/mcp-tools/test/exact-capability.integration.test.ts`, `service.integration.test.ts`, and shell tests as the base; split test files if Prettier pushes any test over 350 lines.

- [ ] **Step 3: Run focused tests and verify GREEN baseline**

```bash
npm run test:integration
npm run test:security
```

Expected: baseline passes before moving code.

- [ ] **Step 4: Extract route helpers without changing endpoint paths**

`api.ts` target shape:

```ts
const handlers: AdminRouteHandler[] = [
  handleWorkspaceRoutes,
  handlePermissionRoutes,
  handleApprovalRoutes,
  handleSessionRoutes,
  handleConnectorRoutes,
  handleSettingsRoutes,
  handleAuditRoutes,
  handleExecutionRoutes,
];

export async function handleAdminApi(req, res, url, context) {
  for (const handler of handlers) {
    if (await handler(req, res, url, context)) return true;
  }
  return false;
}
```

Put JSON-body parsing/response helpers in `request-body.ts` and shared route types only in `types.ts`. Do not create a generic mega-utility file.

- [ ] **Step 5: Extract MCP tool groups behind explicit context**

`service-types.ts` exports the dependency contract used by tool modules. `service.ts` retains session-level entry points, approval resume orchestration, and `call()` dispatch; file/command/git/process implementation moves into the named modules.

Example command interface:

```ts
export async function runCommandTool(
  context: ToolExecutionContext,
  sessionId: string,
  args: CommandRunArgs,
  source?: ShellSource,
): Promise<unknown>;
```

Keep the normalized command matcher, host-fallback suffix, one-time grants, and approval ticket payload unchanged.

- [ ] **Step 6: Run focused tests after each extraction group**

After admin routes:

```bash
npm run test:integration
```

After MCP tool modules:

```bash
node scripts/test.mjs integration
node scripts/test.mjs security
```

Expected: 0 failures.

- [ ] **Step 7: Verify LOC/typecheck**

```bash
npm run lint:loc
npm run typecheck
```

Every extracted TS file must be <=350 lines. Fix type errors rather than re-enabling `noCheck`.

- [ ] **Step 8: Commit**

```bash
git add apps/core/src/admin/routes apps/core/test packages/mcp-tools/src packages/mcp-tools/test
git commit -m "refactor: split admin and mcp tool modules"
```

---

### Task 6: Replace vanilla v1/v2/v3 script layering with focused ES modules

**Files:**
- Modify: `apps/web/index.html`
- Create: `apps/web/main.js`
- Create: `apps/web/core/api.js`
- Create: `apps/web/core/dom.js`
- Create: `apps/web/core/time.js`
- Create: `apps/web/components/toast.js`
- Create: `apps/web/components/modal.js`
- Create: `apps/web/components/data-table.js`
- Create: `apps/web/components/request-drawer.js`
- Create: `apps/web/components/remote-access.js`
- Create: `apps/web/components/onboarding.js`
- Create: `apps/web/pages/dashboard.js`
- Create: `apps/web/pages/permissions.js`
- Create: `apps/web/pages/workspaces.js`
- Create: `apps/web/pages/sessions.js`
- Create: `apps/web/pages/processes.js`
- Create: `apps/web/pages/changes.js`
- Create: `apps/web/pages/audit.js`
- Create: `apps/web/pages/settings.js`
- Create: `apps/web/pages/guide.js`
- Create: `apps/web/data/safe-command-matchers.js`
- Create: `apps/web/styles/tokens.css`
- Create: `apps/web/styles/shell.css`
- Create: `apps/web/styles/components.css`
- Create: `apps/web/styles/dashboard.css`
- Create: `apps/web/styles/admin.css`
- Create: `apps/web/styles/requests.css`
- Delete after parity tests pass: `apps/web/app.js`, `apps/web/app-v2.js`, `apps/web/app-v3.js`, `apps/web/ui-runtime.js`, `apps/web/admin-enhancements.js`, old superseded CSS files, old `data-table.js`, old `safe-command-matchers.js`.
- Create: `apps/web/test/dashboard.test.js`
- Create: `apps/web/test/requests.test.js`
- Create: `apps/web/test/admin-pages.test.js`
- Create: `apps/web/test/guide.test.js`
- Create: `apps/web/test/data-table.test.js`
- Modify static contract tests under `scripts/test/` only where they still protect packaging/entry contracts.

**Interfaces:**
- `requestJson(path, init?): Promise<T>` centralized same-origin client.
- `mountDataTable(element, options)` module export replacing `window.AevraDataTable`.
- Every page exports `renderXPage(container, context): Promise<Cleanup | void>`.
- `main.js` owns navigation and calls page cleanup before mounting the next page.

- [ ] **Step 1: Create behavior tests for reusable modules first**

Vitest/jsdom tests must cover:

```js
expect(await requestJson('/api/status')).toEqual(fakeStatus);
expect(renderDashboardOrder({ completed: false })).toEqual([
  'onboarding',
  'runtime-overview',
  'active-connections',
  'tool-activity',
  'connections',
  'recent-activity',
]);
expect(renderDashboardOrder({ completed: true }).at(-1)).toBe('onboarding');
```

Request drawer tests must assert non-critical command actions expose once/session/workspace/global and critical cards expose only once/deny.

- [ ] **Step 2: Run web unit tests and verify RED**

```bash
vitest run --config vitest.web.config.ts
```

Expected: new modules do not exist.

- [ ] **Step 3: Build core/component modules**

Move API, escaping, time, toast, modal, data table, request drawer, Remote Access, Onboarding, and safe matcher logic first. Keep functions dependency-injected where browser globals would make tests difficult.

Example page contract:

```js
export async function renderDashboardPage(container, context) {
  const controller = new AbortController();
  // fetch/render/wire using context.api and context.tables
  return () => controller.abort();
}
```

- [ ] **Step 4: Build page modules and thin entry point**

`main.js` owns only shell install, current page selection, Requests drawer ownership, and page lifecycle. It must not contain page-specific HTML.

`index.html` must load exactly one application entry:

```html
<script type="module" src="/main.js"></script>
```

and the new focused stylesheets.

- [ ] **Step 5: Preserve Dashboard + admin behavior while removing compatibility layers**

Port all user-visible behavior from the old scripts before deleting them: Dashboard/runtime tables, completed-onboarding bottom placement, Cloudflare Remote Access, Permissions/Workspaces/Sessions tables, Processes/Changes, Audit, Settings, Guide/Copy All, toasts, browser request notifications, and request approval scopes.

- [ ] **Step 6: Delete superseded scripts only after tests prove parity**

Run:

```bash
npm run test:web
vitest run --config vitest.web.config.ts
```

Then remove the old v1/v2/v3/enhancement/runtime files and update static tests to assert they are absent and `main.js` is the sole entry.

- [ ] **Step 7: Split CSS by responsibility**

Each stylesheet must remain <=500 lines. Keep shared CSS variables in `tokens.css`; shell/nav/layout in `shell.css`; reusable controls/modal/table/toast in `components.css`; Dashboard/Onboarding in `dashboard.css`; admin forms/pages in `admin.css`; Requests in `requests.css`.

- [ ] **Step 8: Verify LOC, dead code, tests, and web coverage**

```bash
npm run lint:loc
npm run lint:deadcode
npm run test:web
npm run test:coverage:web
```

Expected: all pass and web coverage reports >=85 for lines/statements/functions/branches.

- [ ] **Step 9: Commit**

```bash
git add apps/web scripts/test vitest.web.config.ts
git commit -m "refactor: modularize vanilla admin ui"
```

---

### Task 7: Remove verified dead code and close Node coverage gaps to 85%

**Files:**
- Modify/delete: only files reported by Knip/TypeScript after Tasks 4-6, with dynamic-entry verification before deletion.
- Modify/add focused tests next to the uncovered production modules reported by c8.
- Delete: `eslint.config.js` only if no package script or dependency uses ESLint after the tooling migration.

**Interfaces:**
- Consumes: `npm run lint:deadcode`, semantic TypeScript, c8 coverage report.
- Produces: zero dead-code findings and >=85 Node coverage in all four metrics.

- [ ] **Step 1: Run dead-code and typecheck reports**

```bash
npm run lint:deadcode
npm run typecheck
```

For each Knip result, first classify it as one of: runtime entry/dynamic reference, public API, genuinely unused internal code. Add the real runtime entry to `knip.json` when valid; do not suppress whole directories.

- [ ] **Step 2: Remove only genuinely unused internals**

Before deletion of any integration-facing symbol, search for CLI/MCP/browser string-based references and run the closest regression suite. Delete a symbol only when the search is empty or the behavior is already covered through an entry-point test.

- [ ] **Step 3: Run Node coverage and inspect uncovered modules**

```bash
npm run test:coverage:node
```

Expected initially: the command may fail below 85. Use the c8 text report to identify exact uncovered branches/functions.

- [ ] **Step 4: Add behavior tests for uncovered production paths**

Prioritize error/security/state transitions rather than trivial getters. Required categories before accepting the gate:

```text
CLI command success + failure exits
admin route success + invalid body + missing entity
approval once/session/workspace/global persistence
critical approval rejection
workspace admission/session switching
MCP command/file/git/process happy + denial paths
worker envelope/IPC failure paths
backup/audit/session maintenance paths
```

Do not add `/* c8 ignore */` to ordinary reachable production code just to raise the score.

- [ ] **Step 5: Repeat until Node coverage passes**

```bash
npm run test:coverage:node
```

Expected: lines >=85, statements >=85, functions >=85, branches >=85.

- [ ] **Step 6: Run all maintainability gates**

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
```

Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: enforce maintainability and coverage gates"
```

---

### Task 8: Final Plan 1 verification checkpoint

**Files:**
- No production changes unless verification exposes a defect.

**Interfaces:**
- Produces the stable vanilla/maintainability baseline required by the React plan.

- [ ] **Step 1: Verify no tracked source exceeds LOC policy**

```bash
npm run lint:loc
```

Expected: `lint:loc ok` and exit 0.

- [ ] **Step 2: Verify formatting and dead code**

```bash
npm run format:check
npm run lint:deadcode
```

Expected: both exit 0.

- [ ] **Step 3: Verify semantic typing**

```bash
npm run typecheck
```

Expected: exit 0 with `noCheck` disabled in the typecheck config.

- [ ] **Step 4: Verify full tests and coverage**

```bash
npm test
npm run test:coverage
```

Expected: all tests pass; both Node and vanilla-web coverage gates meet >=85 lines/statements/functions/branches.

- [ ] **Step 5: Verify package build**

```bash
npm run build
```

Expected: exit 0 and `dist/apps/web/` contains the modular vanilla UI.

- [ ] **Step 6: Manual local smoke**

```bash
npm link
aevra start --ui
```

Verify: Dashboard loads; Remote Access is inside Onboarding; incomplete Onboarding appears near the top; after marking it complete it moves to the Dashboard bottom; collapsing it remains collapsed across periodic refresh; Requests, Permissions, Workspaces, Sessions, Processes, Changes, Audit, Settings, and Guide remain functional.

- [ ] **Step 7: Record the passing baseline commit SHA**

```bash
git rev-parse HEAD
```

Use this SHA as the starting point for `2026-08-19-react-ui-parity-plan.md`.
