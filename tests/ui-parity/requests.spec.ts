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

    await expect(page.getByText('ChatGPT requests commands.run')).toBeVisible();
    await expect(page.getByText('Saved matcher')).toBeVisible();
    await expect(page.getByText('git:status:--short')).toBeVisible();
    for (const label of [
      'Deny',
      'Run once',
      'Allow this session',
      'Always in workspace',
      'Always globally',
    ]) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
  });

  test(`${surface.name} keeps CRITICAL command approvals one-time only`, async ({ page }) => {
    await installAdminApi(page, {
      approvals: [{ ...commandApproval, id: 'critical-1', risk: 'CRITICAL' }],
    });
    await page.goto(surface.path);
    await page.locator('#open-requests').click();

    await expect(page.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run once', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allow this session', exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('button', { name: 'Always in workspace', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Always globally', exact: true })).toHaveCount(0);
  });
}
