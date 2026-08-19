import { expect, test } from '@playwright/test';
import { installAdminApi } from './fixtures';

for (const viewport of [
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name} keeps horizontal tabs and primary controls reachable`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installAdminApi(page);
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Aevra admin' });
    await expect(nav).toBeVisible();
    await expect(page.getByRole('button', { name: /Switch to .* mode/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Requests/ })).toBeVisible();

    const navStyle = await nav.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        display: style.display,
        flexWrap: style.flexWrap,
        overflowX: style.overflowX,
      };
    });
    expect(navStyle.display).toBe('flex');
    expect(navStyle.flexWrap).toBe('nowrap');
    expect(['auto', 'scroll']).toContain(navStyle.overflowX);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(1);
  });
}
