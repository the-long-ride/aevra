import { expect, test, type Page } from '@playwright/test';
import { installAdminApi } from './fixtures';

const totals = {
  calls: 12,
  errors: 1,
  inputTokens: 1200,
  outputTokens: 3600,
  savedTokens: 2400,
  avgDurationMs: 20,
};
const report = {
  estimator: 'heuristic-v1',
  range: 'all',
  granularity: 'day',
  totals,
  today: totals,
  topToolToday: null,
  series: [],
  byTool: [{ tool: 'files_read', ...totals }],
  byConnector: [{ connector: 'client:alpha', label: 'Alpha', ...totals }],
};
const base = {
  transport: 'stdio',
  config: { command: 'node', args: ['server.js'] },
  auth: { kind: 'none' },
  risk: 'MEDIUM',
  enabled: true,
  state: 'active',
  documentationSource: 'accepted',
  tools: Array.from({ length: 20 }, (_, index) => ({
    name: `read_documents_${index}`,
    description: `Read document ${index} by path.`,
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string', description: 'Document path' } },
      examples: [{ path: '/docs/readme.md' }],
    },
    annotations: { readOnlyHint: true },
  })),
  toolCount: 12,
  resourceCount: 0,
  promptCount: 0,
  pendingCatalogDiff: null,
  advisory: Array.from({ length: 20 }, (_, index) => ({
    tool: `read_documents_${index}`,
    readOnlyHint: true,
  })),
  createdAt: '2026-10-15T00:00:00Z',
  updatedAt: '2026-10-15T00:00:00Z',
};

async function installUiApi(page: Page) {
  await installAdminApi(page);
  const fixtures: Record<string, unknown> = {
    '/api/browser': { extensionId: null, pairedAt: null },
    '/api/desktop/access-requests': { requests: [] },
    '/api/activity': [],
    '/api/agents': { registrations: [] },
    '/api/agents/detect': [],
    '/api/desktop/apps': { apps: [], warnings: [] },
    '/api/desktop/app-grants': { grants: [] },
    '/api/desktop/policy': { mode: 'denylist', applications: [], unattributedInput: 'deny' },
  };
  for (const [path, json] of Object.entries(fixtures)) {
    await page.route(`**${path}`, (route) => route.fulfill({ json }));
  }
  await page.route('**/api/activity/stream', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' }),
  );
}

for (const width of [320, 768, 1024, 1440]) {
  test(`MCP status and hints at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await installUiApi(page);
    await page.route('**/api/mcp/upstreams', (route) =>
      route.fulfill({
        json: {
          upstreams: [
            { ...base, id: 'a', name: 'Active server', advisory: [] },
            { ...base, id: 'b', name: 'Disabled server', enabled: false },
            { ...base, id: 'c', name: 'Degraded server', state: 'degraded' },
            {
              ...base,
              id: 'd',
              name: 'Review server',
              state: 'needs-review',
              pendingCatalogDiff: { added: ['new_tool'], changed: [], removed: [] },
            },
          ],
        },
      }),
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const region = page.getByRole('region', { name: 'MCP upstream servers' });
    if (width === 1440) await page.getByRole('button', { name: /Switch to dark mode/ }).click();
    await region.scrollIntoViewIfNeeded();
    const active = region.getByRole('row', { name: 'Active server', exact: true });
    await expect(active.locator('.status')).toHaveText('Active');
    await expect(active.locator('.status')).toHaveClass(/success/);
    const disabled = region.getByRole('row', { name: 'Disabled server', exact: true });
    await expect(disabled.locator('.status')).toHaveCount(1);
    await expect(disabled.locator('.status')).toHaveText('Disabled');
    await expect(
      region.getByRole('row', { name: 'Degraded server', exact: true }).locator('.status'),
    ).toHaveClass(/warning/);
    await expect(
      region.getByRole('button', { name: 'Review catalog changes for Review server' }),
    ).toBeVisible();
    await expect(region.locator('details')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('mcp-table.png') });
    const trigger = region.getByRole('button', { name: 'Detail for Disabled server' });
    await expect(trigger.locator('circle')).toHaveCSS('fill', 'none');
    await trigger.click();
    const modal = page.getByRole('dialog', { name: /Detail/ });
    await expect(modal).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(modal.locator('summary').filter({ hasText: 'read_documents_19' })).toBeFocused();
    await expect(modal).toContainText('advisory only');
    await modal.locator('summary').filter({ hasText: 'read_documents_0' }).focus();
    await page.keyboard.press('Enter');
    await expect(modal.getByText('Read document 0 by path.', { exact: true })).toBeVisible();
    await expect(modal.getByLabel('Example arguments for read_documents_0')).toContainText(
      '/docs/readme.md',
    );
    await page.screenshot({ path: testInfo.outputPath('tool-instructions.png') });
    await modal.getByRole('searchbox', { name: 'Search tools' }).fill('document 0');
    await expect(modal.getByText('read_documents_19', { exact: true })).toHaveCount(0);
    await modal.getByRole('searchbox', { name: 'Search tools' }).fill('');
    const content = modal.locator('.mcp-upstream-hints-content');
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(modal.getByText('read_documents_19', { exact: true })).toBeInViewport();
    const bounds = await modal.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath('hints-modal.png') });
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(errors).toEqual([]);
  });

  test(`all-time statistics at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await installUiApi(page);
    await page.route('**/api/usage/tokens?range=all', (route) => route.fulfill({ json: report }));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
    });
    await page.goto('/');
    const history = page.getByRole('region', { name: 'Token usage history' });
    const trigger = history.getByRole('button', { name: 'All-time statistics' });
    const all = history.getByRole('button', { name: 'All', exact: true });
    await expect(all.locator('xpath=following-sibling::button[1]')).toHaveAccessibleName(
      'All-time statistics',
    );
    await trigger.click();
    const modal = page.getByRole('dialog', { name: 'All-time token statistics' });
    await expect(modal.getByText('files_read', { exact: true })).toBeVisible();
    await expect(modal.getByLabel('Input tokens', { exact: true })).toContainText('1.2k');
    await expect(modal.getByLabel('Average tokens per call')).toContainText('400');
    const savings = modal.getByLabel('Saved tokens', { exact: true });
    await expect(savings.locator('strong')).toHaveText('2.4k ~ 40%');
    await expect(modal.locator('.token-stat-detail')).toHaveCount(0);
    for (const value of await modal.locator('.token-stat-value').all()) {
      await expect(value).toHaveCSS('font-size', '28px');
      expect(await value.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }

    await expect(modal.getByText('Alpha', { exact: true })).toBeVisible();
    const bounds = await modal.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath('statistics-modal.png') });
    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(trigger).toBeFocused();
    await expect(history.getByRole('button', { name: '24h' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(errors).toEqual([]);
  });
}
