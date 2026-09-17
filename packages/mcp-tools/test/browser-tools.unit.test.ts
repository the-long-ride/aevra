import assert from 'node:assert/strict';
import test from 'node:test';
import { handleBrowserTool, BROWSER_TOOL_NAMES } from '../src/browser-tools.js';
import { resetVisited } from '../src/browser-risk.js';
import { browserContext as context } from './browser-context.js';

test.beforeEach(() => resetVisited('s1'));

test('the tool surface is exactly the nine designed tools', () => {
  assert.deepEqual([...BROWSER_TOOL_NAMES].sort(), [
    'browser_act_many',
    'browser_connect',
    'browser_disconnect',
    'browser_logs',
    'browser_navigate',
    'browser_read',
    'browser_snapshot',
    'browser_status',
    'browser_tabs',
  ]);
});

test('browser_connect forwards the transport, epoch, and paired extension id', async () => {
  const ctx = context();
  ctx.value.deps.browserPairing = {
    epoch: () => 4,
    pairedExtensionId: () => 'abcdefghijklmnopabcdefghijklmnop',
  };
  await handleBrowserTool(ctx.value, 's1', 'browser_connect', { transport: 'extension' });
  const sent = ctx.worker.calls.at(-1).operation;
  assert.equal(sent.kind, 'browser.connect');
  assert.equal(sent.epoch, 4);
  assert.equal(sent.extensionId, 'abcdefghijklmnopabcdefghijklmnop');
});

test('browser_snapshot defaults to the a11y mode and a bounded node budget', async () => {
  const ctx = context();
  await handleBrowserTool(ctx.value, 's1', 'browser_snapshot', {});
  const sent = ctx.worker.calls.at(-1).operation;
  assert.equal(sent.mode, 'a11y');
  assert.equal(sent.maxNodes, 400);
});

test('browser_act_many rejects an empty action list before dispatch', async () => {
  const ctx = context();
  await assert.rejects(
    () => handleBrowserTool(ctx.value, 's1', 'browser_act_many', { actions: [] }),
    /at least one action/,
  );
});

test('browser_status needs no live session and reports the paired epoch', async () => {
  const ctx = context();
  ctx.value.deps.browserPairing = { epoch: () => 2, pairedExtensionId: () => null };
  const status: any = await handleBrowserTool(ctx.value, 's1', 'browser_status', {});
  assert.equal(status.epoch, 2);
  assert.equal(status.extensionPaired, false);
});

test('an unknown browser tool name is rejected', async () => {
  const ctx = context();
  await assert.rejects(
    () => handleBrowserTool(ctx.value, 's1', 'browser_evaluate', {}),
    /not enabled/,
  );
});

test('browser_disconnect tears the session down without touching pairing state', async () => {
  const ctx = context();
  await handleBrowserTool(ctx.value, 's1', 'browser_disconnect', {});
  assert.equal(ctx.worker.calls.at(-1).operation.kind, 'browser.disconnect');
});

test('browser_connect omits epoch and extensionId when nothing is paired', async () => {
  const ctx = context();
  await handleBrowserTool(ctx.value, 's1', 'browser_connect', { transport: 'cdp', cdpPort: 9333 });
  const sent = ctx.worker.calls.at(-1).operation;
  assert.equal(sent.transport, 'cdp');
  assert.equal(sent.cdpPort, 9333);
  assert.equal('epoch' in sent, false);
  assert.equal('extensionId' in sent, false);
});

test('browser_connect forwards an explicit starting tab', async () => {
  const ctx = context();
  await handleBrowserTool(ctx.value, 's1', 'browser_connect', {
    transport: 'cdp',
    tabId: 'tab-7',
  });
  assert.equal(ctx.worker.calls.at(-1).operation.tabId, 'tab-7');
});

test('a tabId matching no open tab is reported rather than silently retargeted', async () => {
  const ctx = context();
  await assert.rejects(
    () => handleBrowserTool(ctx.value, 's1', 'browser_read', { tabId: 'missing' }),
    /No browser tab matches missing/,
  );
});

test('an array result is wrapped under result so the untrusted marker survives', async () => {
  const ctx = context();
  const listed: any = await handleBrowserTool(ctx.value, 's1', 'browser_tabs', {
    action: 'list',
  });
  assert.equal(listed.untrusted, true);
  assert.ok(Array.isArray(listed.result));
});

test('browser_logs passes its clamped bounds through and returns untrusted content', async () => {
  const ctx = context();
  const logs: any = await handleBrowserTool(ctx.value, 's1', 'browser_logs', {
    kind: 'network',
    limit: 9999,
  });
  const sent = ctx.worker.calls.at(-1).operation;
  assert.equal(sent.logKind, 'network');
  assert.equal(sent.limit, 500);
  assert.equal(logs.untrusted, true);
});
