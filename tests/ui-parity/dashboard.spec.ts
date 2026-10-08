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
    await expect(runtime.getByText('Tokens out today')).toBeVisible();
    await expect(runtime.getByText('No token usage recorded yet.')).toBeVisible();
    await expect(runtime.getByText('Version', { exact: true })).toHaveCount(0);
    await runtime.locator(':scope > summary').click();
    await expect(runtime).not.toHaveAttribute('open', '');
  });

  test(`${surface.name} keeps system capabilities final after completed onboarding and preserves collapse through polling`, async ({
    page,
  }) => {
    await installAdminApi(page, { onboardingCompleted: true });
    await page.goto(surface.path);
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

    const sections = page.locator('[data-dashboard-section]');
    const ids = await sections.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-dashboard-section')),
    );
    expect(ids.at(-1)).toBe('system-capabilities');
    expect(ids.at(-2)).toBe('onboarding');

    const onboarding = page.locator('[data-dashboard-section="onboarding"]');
    await expect(onboarding).not.toHaveAttribute('open', '');
    await page.waitForTimeout(2200);
    await expect(onboarding).not.toHaveAttribute('open', '');
  });
}

test('runtime metrics and charts adapt from desktop to tablet and mobile', async ({ page }) => {
  await installAdminApi(page);
  await page.setViewportSize({ width: 1720, height: 980 });
  await page.goto('/');

  const runtime = page.locator('[data-dashboard-section="runtime-overview"]');
  const metrics = runtime.locator('.runtime-grid');
  const tokens = metrics.locator(':scope > .token-usage-stats');
  const charts = runtime.locator('.runtime-charts');

  await expect(tokens.locator('.token-stat')).toHaveCount(5);
  await expect(tokens.getByText('Tokens out today')).toBeVisible();
  await expect(charts.locator(':scope > section')).toHaveCount(2);

  const connectorBox = await metrics.locator(':scope > .runtime-stat').last().boundingBox();
  const tokenBox = await tokens.boundingBox();
  expect(connectorBox).not.toBeNull();
  expect(tokenBox).not.toBeNull();
  expect(Math.abs(tokenBox!.y - connectorBox!.y)).toBeLessThan(2);
  expect(tokenBox!.x).toBeGreaterThan(connectorBox!.x);

  // The token metrics must share borders with Connectors, not float inside a padded card group.
  const firstCell = await tokens.locator('.token-stat').first().boundingBox();
  const lastCell = await tokens.locator('.token-stat').last().boundingBox();
  expect(firstCell).not.toBeNull();
  expect(lastCell).not.toBeNull();
  expect(Math.abs(firstCell!.x - (connectorBox!.x + connectorBox!.width))).toBeLessThan(2);
  expect(Math.abs(firstCell!.y - connectorBox!.y)).toBeLessThan(2);
  expect(Math.abs(firstCell!.height - connectorBox!.height)).toBeLessThan(2);
  expect(Math.abs(lastCell!.x + lastCell!.width - (tokenBox!.x + tokenBox!.width))).toBeLessThan(2);
  expect(
    await tokens.evaluate((element) => {
      const grid = element.querySelector('.token-usage-grid')!;
      const cell = grid.querySelector('.token-stat')!;
      return {
        wrapperPadding: getComputedStyle(element).paddingLeft,
        gap: getComputedStyle(grid).columnGap,
        radius: getComputedStyle(cell).borderTopLeftRadius,
        borderTop: getComputedStyle(cell).borderTopWidth,
        borderRight: getComputedStyle(cell).borderRightWidth,
      };
    }),
  ).toEqual({
    wrapperPadding: '0px',
    gap: '0px',
    radius: '0px',
    borderTop: '0px',
    borderRight: '1px',
  });
  expect(
    await tokens
      .locator('.token-stat-label')
      .first()
      .evaluate((node) => ({
        fontSize: getComputedStyle(node).fontSize,
        textTransform: getComputedStyle(node).textTransform,
      })),
  ).toEqual({ fontSize: '10px', textTransform: 'uppercase' });
  expect(
    await tokens
      .locator('.token-stat-value')
      .first()
      .evaluate((node) => getComputedStyle(node).fontSize),
  ).toBe('16px');

  const columns = async () =>
    charts.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(await columns()).toBe(2);

  await page.setViewportSize({ width: 1100, height: 900 });
  expect(await columns()).toBe(2);

  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await columns()).toBe(1);
    await expect(tokens.getByText('Tokens out today')).toBeVisible();

    const connector = await metrics.locator(':scope > .runtime-stat').last().boundingBox();
    const tokenSection = await tokens.boundingBox();
    const first = await tokens.locator('.token-stat').first().boundingBox();
    expect(connector).not.toBeNull();
    expect(tokenSection).not.toBeNull();
    expect(first).not.toBeNull();
    const metricsBox = await metrics.boundingBox();
    expect(metricsBox).not.toBeNull();
    expect(Math.abs(tokenSection!.x - (metricsBox!.x + 1))).toBeLessThan(2);
    expect(Math.abs(first!.x - tokenSection!.x)).toBeLessThan(2);
    expect(Math.abs(first!.y - (connector!.y + connector!.height))).toBeLessThan(2);

    if (width === 390) {
      const finalCell = await tokens.locator('.token-stat').last().boundingBox();
      expect(finalCell).not.toBeNull();
      expect(Math.abs(finalCell!.width - tokenSection!.width)).toBeLessThan(2);
    }
  }
});
