import { expect, test } from '@playwright/test';
import { ADMIN_SURFACES, installAdminApi } from './fixtures';

const permissions = Array.from({ length: 30 }, (_, index) => ({
  id: `rule-${index + 1}`,
  effect: index % 2 === 0 ? 'allow' : 'deny',
  capability: index % 3 === 0 ? 'commands.run' : 'files.read',
  scope: 'workspace',
  actor: `actor-${index + 1}`,
  matcher: index % 3 === 0 ? 'git:status' : '*',
}));

const sessions = [
  {
    id: 'session-chatgpt',
    actor: 'ChatGPT',
    activeLeaseId: 'lease-1',
    lease: { workspaceId: 'ws-1' },
  },
  { id: 'session-claude', actor: 'Claude', activeLeaseId: null, lease: null },
];

for (const surface of ADMIN_SURFACES) {
  test(`${surface.name} permissions table searches filters and paginates`, async ({ page }) => {
    await installAdminApi(page, { permissions });
    await page.goto(surface.path);
    await page.getByRole('button', { name: 'Permissions', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Permissions', exact: true })).toBeVisible();

    await expect(page.getByText('Page 1 / 2', { exact: true })).toBeVisible();
    const search = page.getByPlaceholder('Search permissions…');
    await search.fill('actor-29');
    await expect(
      page.getByRole('cell', { name: 'actor-29', exact: true }),
    ).toBeVisible();

    await search.fill('');
    await expect(page.getByText('1–25 of 30', { exact: true })).toBeVisible();

    const effect = page.getByLabel('Effect').first();
    await effect.selectOption('deny');
    await expect(page.getByText('1–15 of 15', { exact: true })).toBeVisible();
  });

  test(`${surface.name} sessions table keeps actor and workspace-state filtering`, async ({
    page,
  }) => {
    await installAdminApi(page, { sessions });
    await page.goto(surface.path);
    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();

    const search = page.getByPlaceholder('Search remote sessions…');
    await search.fill('ChatGPT');
    await expect(page.getByRole('cell', { name: 'session-chatgpt', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'session-claude', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Actor')).toBeVisible();
    await expect(page.getByLabel('Workspace state')).toBeVisible();
  });
}
