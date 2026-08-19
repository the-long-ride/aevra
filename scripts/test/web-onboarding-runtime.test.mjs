import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtimeStatus = readFileSync(
  'apps/web/components/runtime-status.js',
  'utf8',
);
const main = readFileSync('apps/web/main.js', 'utf8');
const dashboard = readFileSync('apps/web/pages/dashboard.js', 'utf8');
const dashboardView = readFileSync('apps/web/pages/dashboard-view.js', 'utf8');

test('completed onboarding remains expandable and is ordered by durable backend state', () => {
  const route = readFileSync(
    'apps/core/src/admin/routes/settings-routes.ts',
    'utf8',
  );
  assert.match(route, /\/api\/onboarding/);
  assert.match(route, /onboarding\.state/);
  assert.match(dashboard, /dashboardOrder\(\s*onboarding\.completed/);
  assert.match(dashboard, /data-dashboard-section/);
  assert.match(dashboard, /openState/);
  assert.doesNotMatch(
    dashboardView,
    /Remote Access remains visible above this section/,
  );
});

test('web header shows the running Aevra version from status rather than a hard-coded UI version', () => {
  const core = readFileSync('apps/core/src/runtime.ts', 'utf8');
  assert.match(runtimeStatus, /\/api\/status/);
  assert.match(runtimeStatus, /status\?\.version/);
  assert.match(main, /app-version/);
  assert.match(core, /version:AEVRA_VERSION/);
  assert.doesNotMatch(runtimeStatus, /v0\.\d+\.\d+/);
});

test('runtime continuously maps Core Worker MCP and Tunnel status into compact health chips', () => {
  const css = readFileSync('apps/web/styles/shell.css', 'utf8');
  assert.match(runtimeStatus, /tunnelReachable/);
  assert.match(runtimeStatus, /data-health/);
  for (const key of ['core', 'worker', 'mcp', 'tunnel']) {
    assert.match(main, new RegExp(`data-health=.{0,3}${key}`));
  }
  assert.match(css, /\.topbar\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.health-chip/);
  assert.match(css, /\[data-state="ok"\]/);
  assert.match(css, /\[data-state="error"\]/);
  assert.match(css, /@keyframes\s+status-pulse/);
});

test('first polling cycle surfaces existing pending requests instead of silently seeding them', () => {
  const notifications = readFileSync(
    'apps/web/components/request-notifications.js',
    'utf8',
  );
  assert.doesNotMatch(notifications, /if\s*\(!seeded\)\s*continue/);
  assert.match(notifications, /Aevra approval request/);
  assert.match(notifications, /OAuth connection request/);
});
