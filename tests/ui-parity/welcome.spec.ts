import { expect, test } from '@playwright/test';
import { installAdminApi } from './fixtures';

test('first launch welcome fits a phone and hands off to highlighted remote access', async ({
  page,
}) => {
  await installAdminApi(page, { welcomeSeen: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: 'Hi, welcome to Aevra' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/We'll use Cloudflare Tunnel/)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/settings$/);
  const highlight = page.locator('[data-surface-id="settings:remote-access-highlight"]');
  await expect(highlight).toHaveClass(/is-highlighted/);
  await expect(highlight).not.toHaveClass(/is-highlighted/, { timeout: 8000 });
});
