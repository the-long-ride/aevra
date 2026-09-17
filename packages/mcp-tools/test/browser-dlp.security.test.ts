import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { handleBrowserTool } from '../src/browser-tools.js';
import { isFirstVisit, noteVisited, resetVisited } from '../src/browser-risk.js';
import { browserContext as context } from './browser-context.js';

test.beforeEach(() => resetVisited('s1'));

// Payloads are generated rather than written as literals: DLP keys on shape,
// not meaning, and this file must not carry anything key-shaped of its own.
function readingPage(ctx: ReturnType<typeof context>, content: string) {
  ctx.worker.execute = async (input: any) => {
    ctx.worker.calls.push(input);
    if (input.operation.kind === 'browser.tabs') {
      return {
        ok: true,
        value: [{ tabId: 't1', url: 'https://example.com/', title: 'x', active: true }],
      };
    }
    return { ok: true, value: { tabId: 't1', url: 'https://example.com/', content } };
  };
}

test('page text runs through DLP before it reaches the model', async () => {
  const ctx = context();
  const payload = randomBytes(32).toString('base64url');
  readingPage(ctx, `the console printed ${payload} at boot`);
  const result: any = await handleBrowserTool(ctx.value, 's1', 'browser_read', { format: 'text' });
  assert.equal(
    String(result.content).includes(payload),
    false,
    'page content reached the model verbatim',
  );
  assert.match(String(result.content), /the console printed/);
});

test('the audit row carries the count that pass produced, not a constant', async () => {
  const ctx = context();
  readingPage(ctx, `the console printed ${randomBytes(32).toString('base64url')} at boot`);
  await handleBrowserTool(ctx.value, 's1', 'browser_read', { format: 'text' });
  assert.ok(ctx.audit.events.at(-1).redactionCount >= 1);
});

test('an ordinary page still records a zero count', async () => {
  const ctx = context();
  await handleBrowserTool(ctx.value, 's1', 'browser_read', { format: 'text' });
  assert.equal(ctx.audit.events.at(-1).redactionCount, 0);
});

test('status reports core and worker epochs separately instead of masking one', async () => {
  const ctx = context();
  ctx.value.deps.browserPairing = { epoch: () => 4, pairedExtensionId: () => null };
  ctx.worker.execute = async (input: any) => {
    ctx.worker.calls.push(input);
    return { ok: true, value: { connected: false, transport: null, tabs: [], epoch: 0 } };
  };
  const status: any = await handleBrowserTool(ctx.value, 's1', 'browser_status', {});
  assert.equal(status.epoch, 4);
  assert.equal(status.workerEpoch, 0);
  // The stamp is what lets a freshly started worker adopt core's epoch without
  // a connect having to happen first.
  assert.equal(ctx.worker.calls.at(-1).operation.epoch, 4);
});

test('disconnecting clears this session visit ledger', async () => {
  const ctx = context();
  noteVisited('s1', 'https://example.com/');
  assert.equal(isFirstVisit('s1', 'https://example.com/'), false);
  await handleBrowserTool(ctx.value, 's1', 'browser_disconnect', {});
  assert.equal(isFirstVisit('s1', 'https://example.com/'), true);
});

test('a tab list is restamped under the policy the gate used', async () => {
  const ctx = context();
  ctx.value.deps.browserPolicy = {
    snapshot: () => ({
      aevraPorts: [9000],
      loopbackClass: 'NORMAL' as const,
      blockedHosts: [],
      sensitiveHosts: [],
    }),
  };
  ctx.worker.execute = async (input: any) => {
    ctx.worker.calls.push(input);
    return {
      ok: true,
      value: [
        { tabId: 't1', url: 'https://example.com/', title: 'x', active: true },
        // A driver runs in the worker, which holds no policy, so it can hand
        // back NORMAL for a configured Aevra port.
        { tabId: 't2', url: 'http://admin.localhost:9000/', title: 'y', originClass: 'NORMAL' },
      ],
    };
  };
  const listed: any = await handleBrowserTool(ctx.value, 's1', 'browser_tabs', { action: 'list' });
  const tabs = listed.result ?? listed;
  assert.equal(tabs[1].originClass, 'BLOCKED');
});
