import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBrowserActions } from '../src/browser-action-input.js';
import { parseBrowserScript } from '../src/browser-script.js';

const rejects = (fn: () => unknown, pattern: RegExp) =>
  assert.throws(fn, (e: any) => e.code === 'INVALID_REQUEST' && pattern.test(e.message));

test('parseBrowserScript rejects empty, oversized and statement-free scripts', () => {
  rejects(() => parseBrowserScript(42), /non-empty string/);
  rejects(() => parseBrowserScript('   '), /non-empty string/);
  rejects(() => parseBrowserScript('x'.repeat(32_769)), /exceeds 32768 characters/);
  rejects(() => parseBrowserScript(' ; ;; '), /at least one statement/);
  const many = Array.from({ length: 33 }, () => "page.keyboard.press('a')").join(';');
  rejects(() => parseBrowserScript(many), /at most 32 statements/);
});

test('parseBrowserScript splits only on top-level semicolons and checks delimiters', () => {
  const actions = parseBrowserScript(
    "await page.locator('a;b').click(); page.locator(\"it\\\"s;\").fill('x')",
  );
  assert.deepEqual(actions, [
    { op: 'click', selector: 'a;b' },
    { op: 'type', selector: 'it"s;', text: 'x', clear: true },
  ]);
  rejects(() => parseBrowserScript("page.locator('a')).click()"), /unbalanced delimiters/);
  rejects(() => parseBrowserScript("page.locator('a).click()"), /unterminated string/);
  rejects(() => parseBrowserScript("page.locator('a'.click()"), /unbalanced delimiters/);
});

test('string literals decode every supported escape', () => {
  const [typed] = parseBrowserScript(
    "page.locator('#f').type('\\n\\r\\t\\b\\f\\v\\0\\\\\\\"\\'\\u0041')",
  );
  assert.deepEqual(typed, {
    op: 'type',
    selector: '#f',
    text: '\n\r\t\b\f\v\0\\"\'A',
    clear: false,
  });
  rejects(() => parseBrowserScript("page.keyboard.press('\\u00zz')"), /invalid unicode escape/);
  rejects(() => parseBrowserScript("page.keyboard.press('\\q')"), /unsupported escape \\q/);
});

test('bounded fields and wait timeouts are enforced', () => {
  rejects(
    () => parseBrowserScript(`page.keyboard.press('${'k'.repeat(129)}')`),
    /key exceeds 128 characters/,
  );
  assert.deepEqual(parseBrowserScript("page.getByText('Done').waitFor({ timeout: 250 })"), [
    { op: 'wait_for', text: 'Done', timeoutMs: 250 },
  ]);
  assert.deepEqual(parseBrowserScript("page.locator('#x').waitFor()"), [
    { op: 'wait_for', selector: '#x', timeoutMs: 5000 },
  ]);
  rejects(() => parseBrowserScript("page.locator('#x').waitFor({ timeout: 0 })"), /timeout must be/);
  rejects(() => parseBrowserScript('page.evaluate(1)'), /unsupported statement/);
});

test('normalizeBrowserActions returns [] for non-arrays and validates shapes', () => {
  assert.deepEqual(normalizeBrowserActions({ op: 'click' }), []);
  const bad: Array<[unknown, RegExp]> = [
    [null, /action must be an object/],
    [[1], /action must be an object/],
    [{ click: 'e1' }, /click must contain an object/],
    [{ op: 'click', ref: ' ' }, /ref must be a nonempty string/],
    [{ op: 'click', selector: '' }, /selector must be a nonempty string/],
    [{ op: 'type', text: 'x' }, /type requires a ref or selector/],
    [{ op: 'select', value: 'x' }, /select requires a ref or selector/],
    [{ op: 'type', ref: 'e1', text: 'x', clear: 'yes' }, /clear must be a boolean/],
    [{ op: 'select', ref: 'e1', value: 3 }, /select requires value/],
    [{ op: 'scroll', ref: 'e1', dx: 1 }, /scroll requires finite dx and dy/],
    [{ op: 'scroll', ref: 'e1', dx: Number.NaN, dy: 1 }, /scroll requires finite dx and dy/],
    [{ op: 'wait_for', timeoutMs: 10 }, /wait_for requires a target or text/],
    [{ op: 'wait_for', text: 'Ready' }, /nonnegative timeoutMs/],
    [{ op: 'wait_for', ref: 'e1', timeoutMs: -1 }, /nonnegative timeoutMs/],
  ];
  for (const [input, pattern] of bad) {
    rejects(() => normalizeBrowserActions([input]), pattern);
  }
});

test('normalizeBrowserActions accepts valid flat and one-key forms', () => {
  assert.deepEqual(
    normalizeBrowserActions([
      { select: { selector: '#s', value: 'b' } },
      { op: 'type', ref: 'e1', text: '', clear: false },
      { op: 'scroll', x: 1, y: 2, dx: 0, dy: 50 },
      { op: 'wait_for', text: 'Ready', timeoutMs: 0 },
    ]),
    [
      { op: 'select', selector: '#s', value: 'b' },
      { op: 'type', ref: 'e1', text: '', clear: false },
      { op: 'scroll', x: 1, y: 2, dx: 0, dy: 50 },
      { op: 'wait_for', text: 'Ready', timeoutMs: 0 },
    ],
  );
});
