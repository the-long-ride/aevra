import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { MAX_WAIT_FOR_MS } from '../../browser/src/driver.js';
import { browserOperation } from '../src/browser-operations.js';

test('tabs defaults to list and carries an explicit url and tab', () => {
  assert.deepEqual(browserOperation('browser_tabs', {}), { kind: 'browser.tabs', action: 'list' });
  assert.deepEqual(
    browserOperation('browser_tabs', { action: 'open', url: 'https://x.test/' }, 't1'),
    {
      kind: 'browser.tabs',
      action: 'open',
      url: 'https://x.test/',
      tabId: 't1',
    },
  );
});

test('navigate defaults waitUntil to load and honours idle', () => {
  const plain = browserOperation('browser_navigate', { url: 'https://x.test/' }) as any;
  const idle = browserOperation('browser_navigate', {
    url: 'https://x.test/',
    waitUntil: 'idle',
  }) as any;
  assert.equal(plain.waitUntil, 'load');
  assert.equal(idle.waitUntil, 'idle');
});

test('snapshot clamps the node budget at both ends', () => {
  const low = browserOperation('browser_snapshot', { maxNodes: 0 }) as any;
  const high = browserOperation('browser_snapshot', { maxNodes: 99_999 }) as any;
  const bad = browserOperation('browser_snapshot', { maxNodes: 'nonsense' }) as any;
  assert.equal(low.maxNodes, 1);
  assert.equal(high.maxNodes, 2000);
  assert.equal(bad.maxNodes, 400, 'a non-numeric budget falls back to the default, not NaN');
});

test('snapshot defaults to a11y and honours vision', () => {
  assert.equal((browserOperation('browser_snapshot', {}) as any).mode, 'a11y');
  assert.equal((browserOperation('browser_snapshot', { mode: 'vision' }) as any).mode, 'vision');
});

test('read defaults to text and passes ref and selector only when present', () => {
  const plain = browserOperation('browser_read', {}) as any;
  assert.equal(plain.format, 'text');
  assert.equal('ref' in plain, false);
  assert.equal('selector' in plain, false);
  const targeted = browserOperation('browser_read', {
    format: 'html',
    ref: 'ref_1_2',
    selector: '#out',
  }) as any;
  assert.equal(targeted.format, 'html');
  assert.equal(targeted.ref, 'ref_1_2');
  assert.equal(targeted.selector, '#out');
});

test('logs default to console and clamp the limit', () => {
  const plain = browserOperation('browser_logs', {}) as any;
  assert.equal(plain.logKind, 'console');
  assert.equal(plain.limit, 50);
  assert.equal((browserOperation('browser_logs', { limit: 10_000 }) as any).limit, 500);
  assert.equal((browserOperation('browser_logs', { limit: 0 }) as any).limit, 1);
  const network = browserOperation('browser_logs', { kind: 'network', since: 'x' }) as any;
  assert.equal(network.logKind, 'network');
  assert.equal(network.since, 'x');
});

test('act defaults stopOnError to true and refuses an empty list', () => {
  const acted = browserOperation('browser_act_many', {
    actions: [{ op: 'press_key', key: 'Enter' }],
  }) as any;
  assert.equal(acted.stopOnError, true);
  assert.equal(
    (
      browserOperation('browser_act_many', {
        actions: [{ op: 'press_key', key: 'Enter' }],
        stopOnError: false,
      }) as any
    ).stopOnError,
    false,
  );
  assert.throws(() => browserOperation('browser_act_many', { actions: [] }), /at least one action/);
  assert.throws(() => browserOperation('browser_act_many', {}), /at least one action/);
});

test('wait_for is refused past the driver ceiling rather than clamped', () => {
  assert.throws(
    () =>
      browserOperation('browser_act_many', {
        actions: [{ op: 'wait_for', selector: '#x', timeoutMs: MAX_WAIT_FOR_MS + 1 }],
      }),
    /timeoutMs must not exceed/,
  );
  assert.doesNotThrow(() =>
    browserOperation('browser_act_many', {
      actions: [{ op: 'wait_for', selector: '#x', timeoutMs: MAX_WAIT_FOR_MS }],
    }),
  );
});

// The payload is generated, never a literal: DLP keys on shape, so a literal
// here would be an actual key-shaped string checked into the repo.
test('secret-shaped outbound text is refused, not redacted', () => {
  const payload = randomBytes(32).toString('base64url');
  for (const action of [
    { op: 'type', ref: 'ref_1_2', text: `value ${payload}` },
    { op: 'select', ref: 'ref_1_3', value: payload },
  ]) {
    assert.throws(
      () => browserOperation('browser_act_many', { actions: [action] }),
      /will not type secret-shaped data/,
      `${action.op} carried a secret-shaped value outward`,
    );
  }
});

test('ordinary words typed into a page are left alone', () => {
  const acted = browserOperation('browser_act_many', {
    actions: [{ op: 'type', ref: 'ref_1_2', text: 'the quick brown fox jumps over it' }],
  }) as any;
  assert.equal(acted.actions[0].text, 'the quick brown fox jumps over it');
});

test('script fast lane compiles to the existing browser.act worker operation', () => {
  const acted = browserOperation(
    'browser_execute_script',
    {
      script: 'page.locator("#name").fill("Aevra"); page.locator("#save").click()',
      stopOnError: false,
    },
    't1',
  ) as any;
  assert.equal(acted.kind, 'browser.act');
  assert.equal(acted.tabId, 't1');
  assert.equal(acted.stopOnError, false);
  assert.deepEqual(acted.actions, [
    { op: 'type', selector: '#name', text: 'Aevra', clear: true },
    { op: 'click', selector: '#save' },
  ]);
});

test('script fast lane applies outbound DLP after parsing', () => {
  const payload = randomBytes(32).toString('base64url');
  assert.throws(
    () =>
      browserOperation('browser_execute_script', {
        script: `page.locator("#note").fill("${payload}")`,
      }),
    /will not type secret-shaped data/,
  );
});
