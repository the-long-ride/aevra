import { expect, test, type Page } from '@playwright/test';
import { installAdminApi } from './fixtures';

/**
 * Panel heads pair a heading with an action button.
 *
 * At phone width the head has to stack: the button keeps `width: 100%` from the
 * small-screen rules, and while the head is still a flex ROW that makes the
 * button a full-width item sharing the line with the heading. Flexbox then
 * shrinks the heading to a sliver and stretches the button to the height of the
 * wrapped title - the oversized action block seen on the Settings page. Nothing
 * overlaps and nothing overflows the document, which is exactly why the existing
 * page-level overflow check in responsive.spec.ts stayed green through it.
 */
async function overlappingHeads(page: Page) {
  return page.evaluate(() => {
    const overlaps: string[] = [];
    for (const head of document.querySelectorAll('.panel-head, .panel-toolbar')) {
      const text = head.querySelector('h2, h3');
      const button = head.querySelector('button');
      if (!text || !button) continue;
      const a = text.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      if (!a.width || !b.width) continue;
      const intersects =
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      if (intersects) overlaps.push(`${text.textContent?.trim()} / ${button.textContent?.trim()}`);
    }
    return overlaps;
  });
}

async function widerThanViewport(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1;
    const wide: string[] = [];
    // Containers only. A table may legitimately exceed the viewport as long as
    // it scrolls inside .dt-scroll instead of widening the page around it.
    for (const element of document.querySelectorAll('.panel, .request-card, .dt-scroll')) {
      if (element.getBoundingClientRect().width > limit) {
        wide.push(element.className);
      }
    }
    return wide;
  });
}

async function unscrollableWideTables(page: Page) {
  return page.evaluate(() => {
    const offenders: string[] = [];
    for (const table of document.querySelectorAll('table.data-table, table.simple-table')) {
      const parent = table.parentElement;
      if (!parent) continue;
      const overflows =
        table.getBoundingClientRect().width > parent.getBoundingClientRect().width + 1;
      if (!overflows) continue;
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX !== 'auto' && overflowX !== 'scroll') offenders.push(parent.className);
    }
    return offenders;
  });
}

/** Heads whose action still shares a line with the heading at phone width. */
async function unstackedHeads(page: Page) {
  return page.evaluate(() => {
    const offenders: string[] = [];
    for (const head of document.querySelectorAll('.compact-panel-head')) {
      const text = head.querySelector('h2, h3');
      const button = head.querySelector(':scope > button');
      if (!text || !button) continue;
      const a = text.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      // Deliberately NOT skipping a zero-width heading: that IS the symptom.
      // A full-width button sharing the row squeezes the heading's box to 0 and
      // spills its text, so a guard on a.width hides the very thing being
      // measured.
      if (!b.width) continue;
      const sharesTheLine = b.top < a.bottom - 1;
      if (sharesTheLine || a.width < 40) {
        offenders.push(
          `${text.textContent?.trim()}: heading ${Math.round(a.width)}px beside a ${Math.round(b.width)}px button`,
        );
      }
    }
    return offenders;
  });
}

for (const viewport of [
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name} settings panels stack their actions instead of overlapping`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installAdminApi(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    expect(await overlappingHeads(page)).toEqual([]);
    expect(await widerThanViewport(page)).toEqual([]);
    expect(await unscrollableWideTables(page)).toEqual([]);
    if (viewport.width <= 640) {
      expect(await unstackedHeads(page)).toEqual([]);
    }
  });

  test(`${viewport.name} permissions and workspaces keep their headings clear`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installAdminApi(page);
    await page.goto('/');

    for (const destination of ['Permissions', 'Workspaces']) {
      await page.getByRole('button', { name: destination, exact: true }).click();
      await expect(page.getByRole('heading', { name: destination })).toBeVisible();
      expect(await overlappingHeads(page)).toEqual([]);
      expect(await widerThanViewport(page)).toEqual([]);
      expect(await unscrollableWideTables(page)).toEqual([]);
      expect(await unscrollableWideTables(page)).toEqual([]);
    }
  });
}

test('mobile keeps the approval modal on screen and its actions tappable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installAdminApi(page, {
    approvals: [
      {
        id: 'approval-mobile-1',
        state: 'PENDING',
        actor: 'connector:ChatGPT',
        risk: 'MEDIUM',
        workspaceId: 'ws-1',
        sessionId: 'session-1',
        operation: { family: 'git:status:--short', capability: 'commands.run' },
        payload: { permissionMatcher: 'git:status:--short' },
        presentation: {
          title: 'ChatGPT requests commands.run',
          action: 'Run command',
          target: 'git status --short',
          preview: '$ git status --short',
        },
      },
    ],
  });
  await page.goto('/');

  const modal = page.getByRole('dialog', { name: 'Approval request' });
  await expect(modal).toBeVisible();

  const box = await modal.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.width).toBeLessThanOrEqual(390);
  // The whole dialog has to fit the viewport; a modal that starts below the fold
  // on a short screen cannot be dismissed without scrolling a page behind it.
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);

  for (const button of await modal.getByRole('button').all()) {
    const size = await button.boundingBox();
    if (!size || size.width === 0) continue;
    expect(size.height).toBeGreaterThanOrEqual(24);
  }
});
