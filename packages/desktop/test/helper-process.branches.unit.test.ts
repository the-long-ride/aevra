import assert from 'node:assert/strict';
import test from 'node:test';
import { HelperProcess, parseHelperError } from '../src/helper-process.js';
import { WindowsDesktopDriver } from '../src/windows-driver.js';

// A self-contained echo helper: answers each JSON-RPC line according to its method.
const SCRIPT = [
  "const rl = require('node:readline').createInterface({ input: process.stdin });",
  "const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');",
  "rl.on('line', (line) => {",
  '  const { id, method, params } = JSON.parse(line);',
  "  if (method === 'stray') { send({ id: 99999, result: 'ignored' }); send({ id, result: 'ok' }); return; }",
  "  if (method === 'nullError') { send({ id, error: null, result: 'fine' }); return; }",
  "  if (method === 'objError') { send({ id, error: { code: 'DESKTOP_REF_STALE', message: 'gone', details: { ref: 'r1', extra: 'dropped', nested: {} } } }); return; }",
  '  send({ id, result: { method, params } });',
  '});',
].join('\n');

function helper() {
  return new HelperProcess({ command: process.execPath, args: ['-e', SCRIPT], deadlineMs: 5000 });
}

test('parseHelperError normalises strings, objects and unknown shapes', () => {
  assert.deepEqual(parseHelperError('plain words'), {
    code: 'DESKTOP_HELPER',
    message: 'plain words',
  });
  assert.deepEqual(parseHelperError({ code: 42 }), {
    code: 'DESKTOP_HELPER',
    message: 'Unknown helper error',
  });
  assert.deepEqual(parseHelperError({ code: 'NOT_ALLOWED', message: 'm' }), {
    code: 'DESKTOP_HELPER',
    message: 'm',
  });
  assert.deepEqual(parseHelperError({ code: 'DESKTOP_TIMEOUT', message: 'm', details: ['x'] }), {
    code: 'DESKTOP_TIMEOUT',
    message: 'm',
  });
  assert.deepEqual(
    parseHelperError({ code: 'DESKTOP_TIMEOUT', message: 'm', details: { other: 1, ref: {} } }),
    { code: 'DESKTOP_TIMEOUT', message: 'm' },
  );
  assert.deepEqual(
    parseHelperError({
      code: 'DESKTOP_WINDOW_BUSY',
      message: 'busy',
      details: { retryAfterMs: 5, reason: 'r', pattern: true },
    }),
    {
      code: 'DESKTOP_WINDOW_BUSY',
      message: 'busy',
      details: { retryAfterMs: 5, reason: 'r', pattern: true },
    },
  );
  for (const raw of [null, 5, ['a']]) {
    assert.deepEqual(parseHelperError(raw), {
      code: 'DESKTOP_HELPER',
      message: 'Unknown helper error',
    });
  }
});

test('replies for unknown ids are ignored and a null error resolves', async () => {
  const process_ = helper();
  try {
    assert.equal(await process_.call('stray', {}), 'ok');
    assert.equal(await process_.call('nullError', {}), 'fine');
    await assert.rejects(
      () => process_.call('objError', {}),
      (error: any) =>
        error.code === 'DESKTOP_REF_STALE' &&
        error.message === 'DESKTOP_REF_STALE: gone' &&
        JSON.stringify(error.details) === JSON.stringify({ ref: 'r1' }),
    );
  } finally {
    process_.kill();
  }
});

test('a helper that cannot start fails its call with DESKTOP_DRIVER_DIED', async () => {
  const process_ = new HelperProcess({
    command: 'aevra-no-such-helper',
    args: [],
    deadlineMs: 5000,
  });
  const before = process_.generation();
  await assert.rejects(() => process_.call('connect', {}), /DESKTOP_DRIVER_DIED|could not start/);
  assert.ok(process_.generation() > before);
});

test('WindowsDesktopDriver forwards window, identity and background calls to the helper', async () => {
  const driver = new WindowsDesktopDriver(helper());
  try {
    assert.deepEqual(await driver.windows(), { method: 'windows', params: {} });
    assert.deepEqual(await driver.focusedWindow(), { method: 'focusedWindow', params: {} });
    assert.deepEqual(await driver.targetIdentity('w1'), {
      method: 'targetIdentity',
      params: { windowId: 'w1' },
    });
    assert.deepEqual(await driver.releaseBackgroundSnapshot('snap'), {
      method: 'releaseBackgroundSnapshot',
      params: { snapshotId: 'snap' },
    });
    const request = {
      snapshotId: 'snap',
      handle: 'h1',
      op: 'invoke',
      expectedInstance: { windowId: 'w1', processId: 1, processStartedAt: 'start' },
    };
    assert.deepEqual(await driver.backgroundAct(request), {
      method: 'backgroundAct',
      params: request,
    });
  } finally {
    await driver.disconnect();
  }
});
