import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserActionInput } from '../../protocol/src/browser.js';
import { actTimeoutMs, DEFAULT_CALL_TIMEOUT_MS, MAX_WAIT_FOR_MS } from '../src/driver.js';
import { ExtensionDriver } from '../src/extension-driver.js';
import type { ExtensionServer } from '../src/extension-server.js';

class ServerStub {
  readonly calls: Array<{ op: string; timeoutMs?: number }> = [];
  peer(): string {
    return 'ext_stub';
  }
  peerId(): string {
    return 'ext_stub';
  }
  async call(op: string, _params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    this.calls.push(timeoutMs === undefined ? { op } : { op, timeoutMs });
    return [];
  }
}

test('a batch with no wait_for keeps the default budget', () => {
  assert.equal(actTimeoutMs([{ op: 'click', ref: 'e1' }]), DEFAULT_CALL_TIMEOUT_MS);
});

test('a short wait_for does not shrink the budget below the default', () => {
  const actions: BrowserActionInput[] = [{ op: 'wait_for', ref: 'e1', timeoutMs: 500 }];
  assert.equal(actTimeoutMs(actions), DEFAULT_CALL_TIMEOUT_MS);
});

test('the budget follows the longest wait in the batch, with room for the round trip', () => {
  const actions: BrowserActionInput[] = [
    { op: 'wait_for', ref: 'e1', timeoutMs: 20_000 },
    { op: 'click', ref: 'e2' },
    { op: 'wait_for', text: 'done', timeoutMs: 45_000 },
  ];
  assert.ok(actTimeoutMs(actions) > 45_000, 'must outlast the wait it is budgeting for');
  assert.ok(actTimeoutMs(actions) <= MAX_WAIT_FOR_MS + 10_000);
});

test('the budget is capped even if a wait somehow arrived above the ceiling', () => {
  const actions: BrowserActionInput[] = [{ op: 'wait_for', text: 'x', timeoutMs: 10 * 60_000 }];
  assert.ok(actTimeoutMs(actions) <= MAX_WAIT_FOR_MS + 10_000);
});

test('a junk timeoutMs falls back to the default rather than producing NaN', () => {
  const actions = [
    { op: 'wait_for', text: 'x', timeoutMs: 'soon' },
  ] as unknown as BrowserActionInput[];
  assert.equal(actTimeoutMs(actions), DEFAULT_CALL_TIMEOUT_MS);
});

test('the extension driver forwards the derived budget to the socket', async () => {
  const server = new ServerStub();
  const driver = new ExtensionDriver(server as unknown as ExtensionServer);
  await driver.connect({ transport: 'extension' });
  await driver.act([{ op: 'wait_for', text: 'done', timeoutMs: 60_000 }], { stopOnError: true });
  const act = server.calls.find((entry) => entry.op === 'act');
  assert.ok(act, 'the act call must reach the socket');
  assert.ok(
    (act.timeoutMs ?? 0) > 60_000,
    `a 60s wait must not run under a ${act.timeoutMs}ms socket budget`,
  );
});

test('calls that carry no batch keep the server default', async () => {
  const server = new ServerStub();
  const driver = new ExtensionDriver(server as unknown as ExtensionServer);
  await driver.connect({ transport: 'extension' });
  assert.equal(server.calls[0]!.op, 'tabs');
  assert.equal(server.calls[0]!.timeoutMs, undefined);
});
