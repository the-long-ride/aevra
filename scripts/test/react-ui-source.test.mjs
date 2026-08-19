import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const requiredFiles = [
  'apps/web-react/design.md',
  'apps/web-react/index.html',
  'apps/web-react/package.json',
  'apps/web-react/tsconfig.json',
  'apps/web-react/vite.config.ts',
  'apps/web-react/src/main.tsx',
  'apps/web-react/src/app/App.tsx',
  'apps/web-react/src/app/hash-navigation.ts',
  'apps/web-react/src/app/use-hash-page.ts',
  'apps/web-react/src/components/AppShell.tsx',
  'apps/web-react/src/services/api-client.ts',
  'apps/web-react/src/hooks/use-polling-resource.ts',
  'apps/web-react/src/hooks/use-runtime-status.ts',
  'apps/web-react/src/hooks/use-theme.ts',
  'apps/web-react/src/features/dashboard/ConnectorModal.tsx',
  'apps/web-react/src/features/dashboard/DashboardPage.tsx',
  'apps/web-react/src/features/requests/RequestDrawer.tsx',
  'apps/web-react/src/features/permissions/PermissionsPage.tsx',
  'apps/web-react/src/features/workspaces/WorkspacesPage.tsx',
  'apps/web-react/src/features/sessions/SessionsPage.tsx',
  'apps/web-react/src/features/processes/ProcessesPage.tsx',
  'apps/web-react/src/features/changes/ChangesPage.tsx',
  'apps/web-react/src/features/audit/AuditPage.tsx',
  'apps/web-react/src/features/settings/SettingsPage.tsx',
  'apps/web-react/src/features/guide/GuidePage.tsx',
];

test('React admin uses a feature-oriented TypeScript architecture', () => {
  for (const file of requiredFiles) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }
});

test('React Vite build is rooted at slash and owns the complete web output', () => {
  const vite = readFileSync('apps/web-react/vite.config.ts', 'utf8');
  assert.match(vite, /base:\s*['"]\/['"]/);
  assert.match(vite, /dist\/apps\/web/);
  assert.match(vite, /emptyOutDir:\s*true/);
  assert.doesNotMatch(vite, /dist\/apps\/web\/react|\/react\//);
});

test('React shell keeps compact horizontal navigation and shared admin contract', () => {
  const app = readFileSync('apps/web-react/src/app/App.tsx', 'utf8');
  const shell = readFileSync('apps/web-react/src/components/AppShell.tsx', 'utf8');
  assert.match(app, /ADMIN_SURFACE/);
  assert.match(shell, /top-nav/);
  assert.match(shell, /theme-toggle/);
  assert.doesNotMatch(shell, /sidebar/i);
});

test('React navigation updates state synchronously and uses popstate for browser history', () => {
  const router = readFileSync('apps/web-react/src/app/use-hash-page.ts', 'utf8');
  const transition = readFileSync('apps/web-react/src/app/hash-navigation.ts', 'utf8');
  assert.match(router, /popstate/);
  assert.match(router, /history\.pushState/);
  assert.doesNotMatch(router, /hashchange/);
  assert.match(transition, /setPage\(next\)/);
  assert.ok(
    transition.indexOf('setPage(next)') < transition.indexOf('pushHash(nextHash)'),
    'React page state must update before browser history',
  );
});

test('React feature pages cover the complete admin navigation surface', () => {
  const app = readFileSync('apps/web-react/src/app/App.tsx', 'utf8');
  for (const page of [
    'DashboardPage',
    'WorkspacesPage',
    'PermissionsPage',
    'SessionsPage',
    'ProcessesPage',
    'ChangesPage',
    'AuditPage',
    'SettingsPage',
    'GuidePage',
  ]) {
    assert.match(app, new RegExp(page));
  }
});

test('React Dashboard and Requests preserve security and onboarding behavior', () => {
  const dashboard = readFileSync('apps/web-react/src/features/dashboard/DashboardPage.tsx', 'utf8');
  const requests = readFileSync('apps/web-react/src/features/requests/RequestDrawer.tsx', 'utf8');
  assert.match(dashboard, /remote-access/);
  assert.match(dashboard, /dashboardOrder/);
  assert.match(dashboard, /completed/);
  assert.doesNotMatch(dashboard, /\['Version'/);
  assert.match(requests, /CRITICAL/);
  assert.match(requests, /approve-global/);
  assert.match(requests, /Saved matcher/);
});

test('React has a single polling owner for approvals and OAuth requests', () => {
  const app = readFileSync('apps/web-react/src/app/App.tsx', 'utf8');
  const runtime = readFileSync('apps/web-react/src/hooks/use-runtime-status.ts', 'utf8');
  const requests = readFileSync('apps/web-react/src/features/requests/RequestDrawer.tsx', 'utf8');
  assert.doesNotMatch(runtime, /\/api\/approvals/);
  assert.doesNotMatch(runtime, /\/api\/oauth\/requests/);
  assert.match(runtime, /usePollingResource/);
  assert.match(app, /onPendingCountChange/);
  assert.match(requests, /onPendingCountChange/);
});

test('React connector flow stays in-page and uses the Dashboard refresh owner', () => {
  const dashboard = readFileSync('apps/web-react/src/features/dashboard/DashboardPage.tsx', 'utf8');
  const connector = readFileSync(
    'apps/web-react/src/features/dashboard/ConnectorModal.tsx',
    'utf8',
  );
  assert.match(dashboard, /ConnectorModal/);
  assert.match(dashboard, /usePollingResource/);
  assert.doesNotMatch(dashboard, /window\.prompt|window\.alert/);
  assert.match(connector, /\/api\/connectors/);
  assert.match(connector, /Copy this token now\. It is shown once\./);
  assert.match(connector, /navigator\.clipboard\.writeText/);
});
