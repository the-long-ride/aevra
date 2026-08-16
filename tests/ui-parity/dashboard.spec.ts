import { expect, test } from '@playwright/test';
import { ADMIN_SURFACES, installAdminApi } from './fixtures';

for (const surface of ADMIN_SURFACES) {
  test(`${surface.name} keeps dashboard section and collapse behavior`, async ({ page }) => {
    await installAdminApi(page);
    await page.goto(surface.path);
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

    const onboardingBlocks = page.locator(
      '[data-dashboard-section="onboarding"] [data-onboarding-section]',
    );
    await expect(onboardingBlocks.first()).toHaveAttribute(
      'data-onboarding-section',
      'remote-access',
    );

    const runtime = page.locator('[data-dashboard-section="runtime-overview"]');
    await expect(runtime).toHaveAttribute('open', '');
    await expect(runtime.getByText('Remote sessions')).toBeVisible();
    await expect(runtime.getByText('Version', { exact: true })).toHaveCount(0);
    await runtime.locator(':scope > summary').click();
    await expect(runtime).not.toHaveAttribute('open', '');
  });

  test(`${surface.name} moves completed onboarding to the bottom and preserves collapse through polling`, async ({
    page,
  }) => {
    await installAdminApi(page, { onboardingCompleted: true });
    await page.goto(surface.path);
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

    const sections = page.locator('[data-dashboard-section]');
    const ids = await sections.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-dashboard-section')),
    );
    expect(ids.at(-1)).toBe('onboarding');

    const onboarding = page.locator('[data-dashboard-section="onboarding"]');
    await expect(onboarding).not.toHaveAttribute('open', '');
    await page.waitForTimeout(2200);
    await expect(onboarding).not.toHaveAttribute('open', '');
  });
}
