import { expect, test } from '@playwright/test';
import { installAdminApi } from './fixtures';

test('theme toggle persists without changing the active page', async ({ page }) => {
  await installAdminApi(page);
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  const toggle = page.getByRole('button', { name: /Switch to .* mode/ });
  const requests = page.getByRole('button', { name: /Requests/ });
  await expect(toggle).toBeVisible();
  await expect(requests).toBeVisible();

  const toggleBeforeRequests = await toggle.evaluate((element, requestsText) => {
    const requestsButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(String(requestsText)),
    );
    return Boolean(
      requestsButton &&
        (element.compareDocumentPosition(requestsButton) &
          Node.DOCUMENT_POSITION_FOLLOWING),
    );
  }, 'Requests');
  expect(toggleBeforeRequests).toBe(true);

  const before = await page.locator('html').getAttribute('data-theme');
  await toggle.click();
  const after = await page.locator('html').getAttribute('data-theme');
  expect(after).not.toBe(before);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', after!);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
