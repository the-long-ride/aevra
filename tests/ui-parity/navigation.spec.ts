import { expect, test } from '@playwright/test';
import { ADMIN_SURFACES, installAdminApi } from './fixtures';

for (const surface of ADMIN_SURFACES) {
  test(`${surface.name} exposes and navigates the full admin surface`, async ({ page }) => {
    await installAdminApi(page);
    await page.goto(surface.path);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

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
      await expect(page.getByRole('heading', { name: destination })).toBeVisible();
    }
  });
}
