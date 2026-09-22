import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBrowserScript } from '../src/browser-script.js';

test('parses the bounded Playwright-like fast path into ordinary browser actions', () => {
  assert.deepEqual(
    parseBrowserScript(`
      await page.locator("#name").fill("Aevra");
      await page.locator("#save").click();
      await page.getByText("Saved").waitFor({ timeout: 2500 });
      await page.keyboard.press("Enter");
    `),
    [
      { op: 'type', selector: '#name', text: 'Aevra', clear: true },
      { op: 'click', selector: '#save' },
      { op: 'wait_for', text: 'Saved', timeoutMs: 2500 },
      { op: 'press_key', key: 'Enter' },
    ],
  );
});

test('preserves semicolons and URL-shaped text inside quoted arguments', () => {
  const actions = parseBrowserScript(
    'page.locator("#note").fill("docs: https://example.com/a;b");',
  );
  assert.equal(actions[0]?.op, 'type');
  assert.equal((actions[0] as any).text, 'docs: https://example.com/a;b');
});

test('supports selector waits and type without clearing', () => {
  assert.deepEqual(
    parseBrowserScript('page.locator(".ready").waitFor(); page.locator("#q").type(" next");'),
    [
      { op: 'wait_for', selector: '.ready', timeoutMs: 5000 },
      { op: 'type', selector: '#q', text: ' next', clear: false },
    ],
  );
});

test('rejects arbitrary JavaScript, page evaluation, and unsupported statements', () => {
  for (const script of [
    'page.evaluate("document.cookie")',
    'fetch("https://example.com")',
    'page.locator("#x").dblclick()',
    'while (true) {}',
  ]) {
    assert.throws(() => parseBrowserScript(script), /browser_execute_script/);
  }
});

test('does not mistake ordinary selector or text content for executable JavaScript', () => {
  assert.deepEqual(
    parseBrowserScript(
      'page.locator("#fetch-results").click(); page.getByText("Function fetch complete").waitFor()',
    ),
    [
      { op: 'click', selector: '#fetch-results' },
      { op: 'wait_for', text: 'Function fetch complete', timeoutMs: 5000 },
    ],
  );
});

test('rejects oversized batches and wait deadlines above the driver ceiling', () => {
  const tooMany = Array.from({ length: 33 }, () => 'page.keyboard.press("Enter")').join(';');
  assert.throws(() => parseBrowserScript(tooMany), /at most 32 statements/);
  assert.throws(
    () => parseBrowserScript('page.locator("#x").waitFor({ timeout: 120001 })'),
    /timeout must be an integer/,
  );
});
