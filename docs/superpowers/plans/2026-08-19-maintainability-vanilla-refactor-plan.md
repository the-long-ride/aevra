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

Add these assertions to the Dashboard source contracts:

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

test('completed onboarding uses bottom placement and stale copy is absent', () => {
  assert.match(v2, /dashboard-bottom/);
  assert.match(v2, /onboarding\.completed/);
  assert.doesNotMatch(v2, /Remote Access remains visible above this section/);
});
```

In `web-dashboard-v3.test.mjs`, add:

```js
assert.doesNotMatch(js, /body\.prepend\(remote\)/);
assert.doesNotMatch(js, /onboarding\.open\s*=\s*true[^}]*setInterval/s);
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test scripts/test/web-dashboard-v2.test.mjs scripts/test/web-dashboard-v3.test.mjs
```

Expected: the containment/order assertion fails because the current renderer emits Remote Access before Onboarding.

- [ ] **Step 3: Move Remote Access inside the current Onboarding body and make completed placement explicit**

Keep the existing Remote Access section literal unchanged except for its location. Add a small ordering helper in `app-v2.js`:

```js
function dashboardMarkup(onboardingMarkup, primaryMarkup, completed) {
  return completed
    ? `${primaryMarkup}<div class="dashboard-bottom">${onboardingMarkup}</div>`
    : `${onboardingMarkup}${primaryMarkup}`;
}
```

Build `onboardingMarkup` from the current `<details class="onboarding-panel">` string after moving the current Remote Access `<section class="setup-section wide dashboard-remote">` into the start of `<div class="onboarding-body">`. Build `primaryMarkup` from Runtime overview, Tool activity, Connections, and Recent activity, then assign:

```js
el.innerHTML = dashboardMarkup(onboardingMarkup, primaryMarkup, onboarding.completed);
```

Delete the sentence `Remote Access remains visible above this section after completion.`

In `app-v3.js`, initialize the open state only once:

```js
if (!onboarding.dataset.dashboardInitialized) {
  onboarding.dataset.dashboardInitialized = 'true';
  onboarding.open = true;
}
```

Do not move Remote Access out of Onboarding in v3.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
node --test scripts/test/web-dashboard-v2.test.mjs scripts/test/web-dashboard-v3.test.mjs
```

Expected: 0 failures.

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

```js
assert.equal(sourceLimit('apps/core/src/runtime.ts'), 350);
assert.equal(sourceLimit('apps/web-react/src/App.tsx'), 400);
assert.equal(sourceLimit('apps/web/main.js'), 350);
assert.equal(sourceLimit('apps/web/styles/base.css'), 500);
assert.equal(sourceLimit('dist/apps/web/app.js'), null);
assert.equal(sourceLimit('node_modules/x/index.js'), null);
assert.equal(countPhysicalLines('a\nb\n'), 2);
assert.equal(
  looksArtificiallyCompressed('const a=1;const b=2;const c=3;'.repeat(30)),
  true,
);
```

`package-quality-scripts.test.mjs` parses `package.json`, requires every script named in **Interfaces**, and requires `format:check` to contain `prettier --check`.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test scripts/test/source-policy.test.mjs scripts/test/package-quality-scripts.test.mjs
```

Expected: the source-policy module and new package scripts are missing.

- [ ] **Step 3: Install dev dependencies and update the lockfile**

```bash
npm install --save-dev prettier knip c8 vitest jsdom @vitest/coverage-v8 @types/node
```

Do not hand-edit `package-lock.json`.

- [ ] **Step 4: Implement source-policy helpers**

`scripts/lib/source-policy.mjs`:

```js
import path from 'node:path';

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
  if (normalized.split('/').some((part) => EXCLUDED_SEGMENTS.has(part))) {
    return null;
  }
  return LIMITS.get(path.extname(normalized)) ?? null;
}

export function countPhysicalLines(text) {
  if (text.length === 0) return 0;
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

export function looksArtificiallyCompressed(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.some(
    (line) => line.length > 500 && (line.match(/[;{}]/g) ?? []).length >= 20,
  );
}
```

`loc-lint.mjs` gets tracked files with:

```js
const tracked = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
```

Fail for a maintained tracked source file when it is artificially compressed or exceeds its extension limit. Print `path: N lines (limit M)` for every LOC failure.

- [ ] **Step 5: Replace newline-only formatting with real Prettier**

Set package scripts:

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

Extend `.prettierignore` with:

```text
coverage
.test-dist
.coverage-dist
```

Keep `scripts/format-check.mjs` as a CRLF/final-newline supplemental check.

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

- [ ] **Step 7: Add initial vanilla Vitest config**

`vitest.web.config.ts` must use jsdom, match `apps/web/test/**/*.test.js`, include `apps/web/**/*.js` for coverage, exclude test files and generated output, and enforce:

```ts
thresholds: {
  lines: 85,
  statements: 85,
  functions: 85,
  branches: 85,
}
```

Plan 2 extends the same config to React tests/source.

- [ ] **Step 8: Add Node coverage runner**

`test-coverage-node.mjs` compiles with `tsc -p tsconfig.test.json`, collects compiled test JS under `.coverage-dist/apps`, `.coverage-dist/packages`, and `.coverage-dist/tests`, then launches c8 with:

```text
--check-coverage --lines 85 --statements 85 --functions 85 --branches 85
--all
--exclude **/*.test.js
--exclude **/test/**
```

The child command is `node --test` with the compiled test paths. Exit with the child status.

- [ ] **Step 9: Add Knip entry configuration**

`knip.json` starts with:

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

Vanilla ES-module entries are added in Task 6 after they exist.

- [ ] **Step 10: Run focused tests**

```bash
node --test scripts/test/source-policy.test.mjs scripts/test/package-quality-scripts.test.mjs
npm run format:check
```

Expected: helper/script tests pass. `lint:loc` is expected to remain red until structural splitting is complete.

- [ ] **Step 11: Commit tooling**

```bash
git add package.json package-lock.json .prettierrc.json .prettierignore scripts knip.json tsconfig.typecheck.json tsconfig.test.json vitest.web.config.ts
git commit -m "build: add repository quality gates"
```

---

### Task 3: Prettier-format maintained source and freeze the real LOC inventory

**Files:**
- Modify: all tracked maintained source matched by Prettier.
- Create: `docs/superpowers/plans/2026-08-19-loc-inventory.txt`

**Interfaces:**
- Consumes: Task 2 formatting/LOC scripts.
- Produces: readable baseline source and an exact checked-in snapshot of violations before structural splitting.

- [ ] **Step 1: Format source**

```bash
npm run format
```

Do not manually collapse formatted output.

- [ ] **Step 2: Capture LOC failures**

```bash
npm run lint:loc > docs/superpowers/plans/2026-08-19-loc-inventory.txt 2>&1
```

Expected: non-zero status because current monoliths exceed limits after formatting.

- [ ] **Step 3: Confirm the known monolith inventory**

The report must be checked specifically for:

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

If a listed file is already within its configured limit, record its measured line count in the inventory and do not split it solely for LOC.

- [ ] **Step 4: Run the pre-refactor regression suite**

```bash
npm test
npm run test:web
```

Expected: 0 failures. Formatting-only regressions are fixed before extraction work.

- [ ] **Step 5: Commit the formatting baseline**

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
- Modify: `apps/cli/test/args.unit.test.ts`
- Modify: `apps/cli/test/backup-cli.unit.test.ts`
- Modify: `apps/cli/test/admin-maintenance-args.unit.test.ts`
- Create: `apps/cli/test/dispatch.unit.test.ts`

**Interfaces:**
- `createAdminSessionClient(config)` returns `{ adminApi(path, init?), openUi(): Promise<void> }`.
- Each command module exports one `runXCommand(command, context): Promise<number>`.
- `cli.ts` owns argument parsing, config creation, dispatch, and executable entry behavior only.

- [ ] **Step 1: Add failing dispatch tests**

`dispatch.unit.test.ts` uses dependency-injected handlers:

```ts
const calls: string[] = [];
const code = await dispatchCommand(
  { command: 'start', ui: true },
  createFakeCliContext({
    runStart: async () => {
      calls.push('start');
      return 0;
    },
  }),
);
assert.deepEqual(calls, ['start']);
assert.equal(code, 0);
```

Add one case for each command discriminant so no branch is untested.

- [ ] **Step 2: Run CLI unit tests and verify RED**

```bash
npm run test:unit
```

Expected: `dispatchCommand` and the handler context are missing.

- [ ] **Step 3: Extract authenticated admin-session helpers**

Move `openBrowser`, `localControl`, bootstrap-cookie creation, `adminApi`, and `openAuthenticatedUi` into `admin-session.ts`. In this plan `openUi()` always targets `/`; Plan 2 expands it to accept `/react/`.

- [ ] **Step 4: Extract command handlers**

Use this shared context:

```ts
export interface CliCommandContext {
  config: ReturnType<typeof loadCoreConfig>;
  log(message: string): void;
  error(message: string): void;
}
```

`status-command.ts` implements the complete current status flow: call `/api/health`; JSON mode prints pretty JSON; text mode prints key/value rows; failure returns 1 with the existing unreachable message.

`setup-command.ts` owns interactive Cloudflare setup/readline. `backup-command.ts` owns verify/restore. `maintenance-command.ts` owns audit clear and session revoke-others. `connectors-command.ts` owns list/create/revoke. `service-command.ts` owns install/start/stop/restart/status. `start-command.ts` owns `runStart`; `ui-command.ts` owns authenticated UI opening.

- [ ] **Step 5: Make `cli.ts` a thin dispatcher**

```ts
export async function dispatchCommand(
  command: AevraCommand,
  context: CliDispatchContext,
): Promise<number> {
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

`main()` parses args, creates the real dispatch context, and returns `dispatchCommand()`.

- [ ] **Step 6: Verify behavior and LOC**

```bash
npm run test:unit
npm run lint:loc
```

Expected: all CLI tests pass and all CLI TS files are <=350 lines.

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
- Modify: `packages/mcp-tools/test/exact-capability.integration.test.ts`
- Modify: `packages/mcp-tools/test/service.integration.test.ts`
- Modify: `packages/mcp-tools/test/shell-run.integration.test.ts`
- Create: `apps/core/test/admin-route-dispatch.integration.test.ts`

**Interfaces:**
- `AdminRouteHandler = (req, res, url, context) => Promise<boolean>`; `true` means handled.
- `handleAdminApi()` becomes an ordered dispatcher over route handlers.
- `ToolExecutionContext` contains dependencies currently captured by `McpToolService`; extracted tool functions receive it explicitly.

- [ ] **Step 1: Add route-dispatch regression coverage**

`admin-route-dispatch.integration.test.ts` must exercise one workspace request, one permission request, one approval request, one settings request, and one unknown API route, comparing HTTP status/body to the pre-extraction behavior.

- [ ] **Step 2: Strengthen MCP regression coverage before moving methods**

The named MCP tests must cover these exact paths:

```text
file_read
file_write exact capability approval
command_run matcher-specific approval
shell_run risk floor
process_start host matcher
approval resume once
critical command persistent-scope rejection
```

Split a test file into additional focused files if its formatted line count exceeds 350.

- [ ] **Step 3: Run baseline integration/security tests**

```bash
npm run test:integration
npm run test:security
```

Expected: 0 failures before extraction.

- [ ] **Step 4: Extract route handlers**

`api.ts` becomes:

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

Keep JSON body parsing/response helpers in `request-body.ts` and shared route types in `types.ts`. Endpoint paths, methods, status codes, and response shapes remain unchanged.

- [ ] **Step 5: Extract MCP tool groups behind explicit context**

`service.ts` keeps session entry, tool dispatch, approval resume, and shared authorization orchestration. File implementations move to `file-tools.ts`; command/shell to `command-tools.ts`; git to `git-tools.ts`; process operations to `process-tools.ts`.

Use this command interface:

```ts
export async function runCommandTool(
  context: ToolExecutionContext,
  sessionId: string,
  args: CommandRunArgs,
  source?: ShellSource,
): Promise<unknown>;
```

Preserve normalized matcher strings, `:host-fallback`, one-time grants, frozen approval payloads, and CRITICAL persistence behavior byte-for-byte where values are externally visible.

- [ ] **Step 6: Run focused tests after each extraction group**

```bash
npm run test:integration
npm run test:security
```

Expected: 0 failures after admin extraction and again after MCP extraction.

- [ ] **Step 7: Verify LOC/typecheck**

```bash
npm run lint:loc
npm run typecheck
```

Every extracted TS file must be <=350 lines; fix semantic errors instead of re-enabling `noCheck`.

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
- Create: `apps/web/test/dashboard.test.js`
- Create: `apps/web/test/requests.test.js`
- Create: `apps/web/test/admin-pages.test.js`
- Create: `apps/web/test/guide.test.js`
- Create: `apps/web/test/data-table.test.js`
- Create: `scripts/check-web-syntax.mjs`
- Modify: `scripts/test/web-admin-shell.test.mjs`
- Modify: `scripts/test/web-dashboard-v2.test.mjs`
- Modify: `scripts/test/web-dashboard-v3.test.mjs`
- Modify: `scripts/test/web-admin-enhancements.test.mjs`
- Modify: `scripts/test/safe-command-guide.test.mjs`
- Modify: `knip.json`
- Modify: `package.json`
- Delete after modular behavior tests pass: `apps/web/app.js`, `apps/web/app-v2.js`, `apps/web/app-v3.js`, `apps/web/ui-runtime.js`, `apps/web/admin-enhancements.js`, `apps/web/app.css`, `apps/web/app-v2.css`, `apps/web/app-v3.css`, `apps/web/admin-enhancements.css`, top-level `apps/web/data-table.js`, top-level `apps/web/safe-command-matchers.js`.

**Interfaces:**
- `requestJson(path, init?)` is the single low-level same-origin browser API client.
- `mountDataTable(element, options)` replaces `window.AevraDataTable`.
- Every page exports `renderXPage(container, context): Promise<(() => void) | void>`.
- `main.js` owns navigation, Requests drawer ownership, and page cleanup only.

- [ ] **Step 1: Add failing reusable behavior tests**

```js
expect(await requestJson('/api/status')).toEqual(fakeStatus);
expect(dashboardOrder(false)).toEqual([
  'onboarding',
  'runtime-overview',
  'active-connections',
  'tool-activity',
  'connections',
  'recent-activity',
]);
expect(dashboardOrder(true).at(-1)).toBe('onboarding');
```

Request drawer tests assert non-critical command actions expose once/session/workspace/global and CRITICAL command cards expose deny + once only.

- [ ] **Step 2: Run web unit tests and verify RED**

```bash
vitest run --config vitest.web.config.ts
```

Expected: modular browser imports are missing.

- [ ] **Step 3: Build core/component modules**

Move API, escaping, time, toast, modal, data table, Requests, Remote Access, Onboarding, and safe matcher logic first. Browser globals are passed through explicit arguments when a test needs to substitute `fetch`, `navigator.clipboard`, `Notification`, timers, or confirmation dialogs.

The Dashboard page contract is:

```js
export async function renderDashboardPage(container, context) {
  const controller = new AbortController();
  const data = await context.dashboardService.load({ signal: controller.signal });
  context.dashboardView.render(container, data);
  const stopPolling = context.dashboardService.startPolling(container, context);
  return () => {
    controller.abort();
    stopPolling();
  };
}
```

- [ ] **Step 4: Build page modules and thin entry point**

`main.js` creates the page registry, handles nav clicks/hash state, calls the previous page cleanup, and mounts the next page. Page-specific HTML stays in page/component modules.

`index.html` loads one application entry:

```html
<script type="module" src="/main.js"></script>
```

It links only the focused stylesheets listed in **Files**.

- [ ] **Step 5: Port the complete supported vanilla surface before deleting compatibility files**

The modular implementation must include Dashboard/runtime tables, completed-onboarding bottom placement, Cloudflare Remote Access, Permissions/Workspaces/Sessions table behavior, Processes/Changes, Audit, Settings, Guide/Copy All, toasts, browser request notifications, connector actions, and request approval scopes.

- [ ] **Step 6: Replace static source tests with modular entry/behavior contracts**

Run:

```bash
npm run test:web
vitest run --config vitest.web.config.ts
```

When green, delete the old v1/v2/v3/enhancement/runtime files and update source-contract tests to assert `main.js` is the sole application script entry and the deleted script names do not appear in `index.html`.

- [ ] **Step 7: Split CSS by responsibility**

Keep shared variables in `tokens.css`; shell/navigation/layout in `shell.css`; table/modal/form/toast controls in `components.css`; Dashboard/Onboarding in `dashboard.css`; admin pages in `admin.css`; Requests in `requests.css`. Every CSS file must remain <=500 lines.

- [ ] **Step 8: Update Knip and build syntax checking for the modular browser entry**

Add:

```json
{
  "entry": ["apps/web/main.js"],
  "project": ["apps/web/**/*.js"]
}
```

to the existing Knip arrays rather than replacing Node entries.

`scripts/check-web-syntax.mjs` walks `apps/web`, runs `node --check` for every `.js` file, and exits non-zero on the first syntax failure. Replace the old long list of `node --check apps/web/<file>` commands in `package.json` with `node scripts/check-web-syntax.mjs`.

- [ ] **Step 9: Verify LOC, dead code, tests, and web coverage**

```bash
npm run lint:loc
npm run lint:deadcode
npm run test:web
npm run test:coverage:web
```

Expected: all pass and vanilla web coverage reports >=85 lines/statements/functions/branches.

- [ ] **Step 10: Commit**

```bash
git add apps/web scripts knip.json package.json
git commit -m "refactor: modularize vanilla admin ui"
```

---

### Task 7: Remove verified dead code and close Node coverage gaps to 85%

**Files:**
- Modify: `knip.json`
- Delete: `eslint.config.js` if `package.json` contains no ESLint dependency/script after Task 6.
- Extend: `apps/cli/test/dispatch.unit.test.ts`
- Extend: `apps/core/test/admin-route-dispatch.integration.test.ts`
- Extend: `packages/mcp-tools/test/exact-capability.integration.test.ts`
- Extend: `packages/mcp-tools/test/service.integration.test.ts`
- Extend: existing worker IPC/envelope tests under `packages/ipc/test/`.
- Extend: backup/audit/session tests in their existing `apps/core/test/` or `apps/cli/test/` suites.

**Interfaces:**
- Consumes: `npm run lint:deadcode`, semantic TypeScript, and c8 text coverage.
- Produces: zero dead-code findings and >=85 Node coverage in all four metrics.

- [ ] **Step 1: Run dead-code and semantic-type reports**

```bash
npm run lint:deadcode
npm run typecheck
```

For a Knip finding, classify it as a real dynamic entry, public API, or unused internal. Add exact valid entries to `knip.json`; do not suppress whole source directories.

- [ ] **Step 2: Remove genuinely unused internals**

For every deletion, search tracked source for the export name and any string-based CLI/MCP/browser registration name, then run the closest test suite. Do not delete a dynamic entry while it is only referenced by a string/registry.

- [ ] **Step 3: Run Node coverage**

```bash
npm run test:coverage:node
```

Use the c8 report to map uncovered paths into the exact test suites listed in **Files**.

- [ ] **Step 4: Cover these production categories until each is represented by success and failure behavior**

```text
CLI dispatch + command failure exits
admin route success + invalid body + missing entity
approval once/session/workspace/global persistence
CRITICAL persistent-scope rejection
workspace admission + session switching
MCP command/file/git/process success + denial
worker envelope/IPC tamper + transport failure
backup/audit/session-maintenance success + failure
```

Do not use blanket `c8 ignore` comments on reachable production paths.

- [ ] **Step 5: Repeat Node coverage until green**

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
- No planned production changes. Any verification failure returns to the task that owns the failing behavior.

**Interfaces:**
- Produces the stable vanilla/maintainability baseline required by the React plan.

- [ ] **Step 1: Verify LOC**

```bash
npm run lint:loc
```

Expected: exit 0 with no tracked maintained TS/TSX/JS/CSS over its configured limit.

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

Expected: all tests pass; Node and vanilla-web coverage each meet >=85 lines/statements/functions/branches.

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

Verify Dashboard loads; Remote Access is inside Onboarding; incomplete Onboarding is near the top; completed Onboarding is at the Dashboard bottom; collapsing it remains collapsed through polling; Requests, Permissions, Workspaces, Sessions, Processes, Changes, Audit, Settings, and Guide remain functional.

- [ ] **Step 7: Record the passing baseline SHA**

```bash
git rev-parse HEAD
```

Use the printed SHA as the prerequisite baseline for `docs/superpowers/plans/2026-08-19-react-ui-parity-plan.md`.
