import { expect, test } from '@playwright/test';
import { ADMIN_SURFACES, installAdminApi } from './fixtures';

for (const surface of ADMIN_SURFACES) {
  test(`${surface.name} exposes and navigates the full admin surface`, async ({ page }) => {
    await installAdminApi(page);
    await page.goto(surface.path);
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

    for (const destination of [
      'Workspaces',
      'Permissions',
      'Sessions',
      'Processes',
      'Changes',
      'Audit',
      'Settings',
      'Guide',
      'Dashboard',
    ]) {
      await page.getByRole('button', { name: destination, exact: true }).click();
      await expect(page.getByRole('heading', { name: destination, exact: true })).toBeVisible();
    }

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Guide', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Guide', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  });
}

test('slow Dashboard work cannot switch the user back after a fast tab change', async ({
  page,
}) => {
  await installAdminApi(page, { dashboardDelayMs: 1000 });
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Guide', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Guide', exact: true })).toBeVisible();
  await page.waitForTimeout(1300);

  await expect(page.getByRole('heading', { name: 'Guide', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/guide$/);
});
