import { expect, test, type Page } from '@playwright/test';
import { ADMIN_SURFACES, installAdminApi } from './fixtures';

function waitsFor(page: Page, path: string, method = 'POST') {
  return page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === path && request.method() === method,
  );
}

for (const surface of ADMIN_SURFACES) {
  test(`${surface.name} runs high-value admin mutations`, async ({ page }) => {
    page.on('dialog', (dialog) => void dialog.accept());
    await installAdminApi(page, {
      permissions: [
        {
          id: 'rule-1',
          effect: 'deny',
          capability: 'commands.run',
          scope: 'workspace',
          actor: 'ChatGPT',
          matcher: 'git:status',
        },
      ],
      mounts: [
        {
          id: 'mount-1',
          logicalPath: '/external/shared',
          hostRoot: '/opt/shared',
          capabilities: ['files.read'],
        },
      ],
      sessions: [
        {
          id: 'session-1',
          actor: 'ChatGPT',
          activeLeaseId: 'lease-1',
          lease: { workspaceId: 'ws-1' },
        },
      ],
      processes: [
        {
          id: 'process-1',
          workspace_id: 'ws-1',
          ownership: 'owned',
          lifecycle: 'running',
        },
      ],
      changes: [
        {
          id: 'change-1',
          name: 'Draft',
          state: 'OPEN',
          workspace_id: 'ws-1',
        },
      ],
    });
    await page.goto(surface.path);

    await page.getByRole('button', { name: 'Permissions', exact: true }).click();
    await page.getByLabel('Effect').first().selectOption('deny');
    const permissionRevoke = waitsFor(page, '/api/permissions/rule-1', 'DELETE');
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    await permissionRevoke;

    await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.getByText('/external/shared')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const workspaceRemove = waitsFor(page, '/api/workspaces/ws-1', 'DELETE');
    await page.getByRole('button', { name: 'Remove', exact: true }).first().click();
    await workspaceRemove;

    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    await page.getByLabel('Workspace state').selectOption('Workspace active');
    const sessionRevoke = waitsFor(page, '/api/sessions/session-1/revoke');
    await page.getByRole('button', { name: 'Revoke', exact: true }).first().click();
    await sessionRevoke;

    await page.getByRole('button', { name: 'Processes', exact: true }).click();
    for (const [label, action] of [
      ['Stop', 'stop'],
      ['Restart', 'restart'],
    ] as const) {
      const mutation = waitsFor(page, `/api/processes/process-1/${action}`);
      await page.getByRole('button', { name: label, exact: true }).click();
      await mutation;
    }

    await page.getByRole('button', { name: 'Changes', exact: true }).click();
    const rollback = waitsFor(page, '/api/changes/change-1/rollback');
    await page.getByRole('button', { name: 'Rollback', exact: true }).click();
    await rollback;

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const sandbox = page.getByLabel('Sandbox backend');
    await sandbox.selectOption('docker');
    const executionForm = sandbox.locator('xpath=ancestor::form');
    const saveExecution = waitsFor(page, '/api/execution-settings', 'PATCH');
    await executionForm.getByRole('button', { name: 'Save', exact: true }).click();
    await saveExecution;

    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'New connector', exact: true }).click();
    await page.getByPlaceholder('Connector name').fill('Parity client');
    const createConnector = waitsFor(page, '/api/connectors');
    await page.getByRole('button', { name: 'Create token', exact: true }).click();
    await createConnector;
    await expect(page.getByText('Copy this token now. It is shown once.')).toBeVisible();
    await expect(page.getByText('secret-once')).toBeVisible();
  });
}
