import { expect, test } from '@playwright/test';
import { ADMIN_SURFACES, installAdminApi } from './fixtures';

const commandApproval = {
  id: 'approval-1',
  state: 'PENDING',
  actor: 'ChatGPT',
  risk: 'MEDIUM',
  workspaceId: 'ws-1',
  operation: { family: 'git:status:--short', capability: 'commands.run' },
  payload: { permissionMatcher: 'git:status:--short' },
  presentation: {
    title: 'ChatGPT requests commands.run',
    action: 'Run command',
    target: 'git status --short',
  },
};

for (const surface of ADMIN_SURFACES) {
  test(`${surface.name} exposes all remembered scopes for non-critical commands`, async ({
    page,
  }) => {
    await installAdminApi(page, { approvals: [commandApproval] });
    await page.goto(surface.path);
    await page.locator('#open-requests').click();
    const drawer = page.locator('.request-drawer[aria-hidden="false"]');

    await expect(drawer.getByText('ChatGPT requests commands.run')).toBeVisible();
    await expect(drawer.getByText('Saved matcher')).toBeVisible();
    await expect(drawer.getByText('git:status:--short')).toBeVisible();
    for (const label of [
      'Deny',
      'Run once',
      'Allow this session',
      'Always in workspace',
      'Always globally',
    ]) {
      await expect(drawer.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
  });

  test(`${surface.name} keeps CRITICAL command approvals one-time only`, async ({ page }) => {
    await installAdminApi(page, {
      approvals: [{ ...commandApproval, id: 'critical-1', risk: 'CRITICAL' }],
    });
    await page.goto(surface.path);
    await page.locator('#open-requests').click();
    const drawer = page.locator('.request-drawer[aria-hidden="false"]');

    await expect(drawer.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Run once', exact: true })).toBeVisible();
    await expect(
      drawer.getByRole('button', { name: 'Allow this session', exact: true }),
    ).toHaveCount(0);
    await expect(
      drawer.getByRole('button', { name: 'Always in workspace', exact: true }),
    ).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Always globally', exact: true })).toHaveCount(
      0,
    );
  });
}
