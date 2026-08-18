import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const requiredFiles = [
  'apps/web-react/index.html',
  'apps/web-react/package.json',
  'apps/web-react/tsconfig.json',
  'apps/web-react/vite.config.ts',
  'apps/web-react/src/main.tsx',
  'apps/web-react/src/app/App.tsx',
  'apps/web-react/src/components/AppShell.tsx',
  'apps/web-react/src/services/api-client.ts',
  'apps/web-react/src/hooks/use-polling-resource.ts',
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

test('React Vite build is rooted at /react/ and writes beside vanilla assets', () => {
  const vite = readFileSync('apps/web-react/vite.config.ts', 'utf8');
  assert.match(vite, /base:\s*['"]\/react\/['"]/);
  assert.match(vite, /dist\/apps\/web\/react/);
  assert.match(vite, /emptyOutDir:\s*false/);
});

test('React shell keeps the same compact top navigation and shared admin contract', () => {
  const app = readFileSync('apps/web-react/src/app/App.tsx', 'utf8');
  const shell = readFileSync(
    'apps/web-react/src/components/AppShell.tsx',
    'utf8',
  );
  assert.match(app, /ADMIN_SURFACE/);
  assert.match(shell, /top-nav/);
  assert.doesNotMatch(shell, /sidebar/i);
});

test('React feature pages cover the complete vanilla navigation surface', () => {
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

test('React Dashboard and Requests preserve approved security and onboarding behavior', () => {
  const dashboard = readFileSync(
    'apps/web-react/src/features/dashboard/DashboardPage.tsx',
    'utf8',
  );
  const requests = readFileSync(
    'apps/web-react/src/features/requests/RequestDrawer.tsx',
    'utf8',
  );
  assert.match(dashboard, /remote-access/);
  assert.match(dashboard, /dashboardOrder/);
  assert.match(dashboard, /completed/);
  assert.match(requests, /CRITICAL/);
  assert.match(requests, /approve-global/);
  assert.match(requests, /Saved matcher/);
});
