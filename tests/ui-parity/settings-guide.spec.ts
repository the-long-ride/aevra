import { expect, test } from '@playwright/test';
import { ADMIN_SURFACES, installAdminApi } from './fixtures';

for (const surface of ADMIN_SURFACES) {
  test(`${surface.name} exposes remote, execution, policy, environment, and secret settings`, async ({
    page,
  }) => {
    await installAdminApi(page);
    await page.goto(surface.path);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    for (const heading of [
      'Remote Access',
      'Execution',
      'Command-family overrides',
      'Network rules',
      'Environment profiles',
      'Secret references',
    ]) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
  });

  test(`${surface.name} Guide copies the selected-platform safe matcher catalog`, async ({ page }) => {
    await installAdminApi(page);
    await page.goto(surface.path);
    await page.getByRole('button', { name: 'Guide', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Guide' })).toBeVisible();
    await page.getByRole('button', { name: 'Safe Command Matchers', exact: true }).click();

    await page.getByRole('button', { name: 'Copy all', exact: true }).click();
    const windowsMatchers = await page.evaluate(() => navigator.clipboard.readText());
    expect(windowsMatchers).toContain('git:status');

    await page.getByRole('button', { name: 'Linux', exact: true }).click();
    await page.getByRole('button', { name: 'Copy all', exact: true }).click();
    const linuxMatchers = await page.evaluate(() => navigator.clipboard.readText());
    expect(linuxMatchers).toContain('git:status');
    expect(linuxMatchers.length).toBeGreaterThan(0);
  });
}
