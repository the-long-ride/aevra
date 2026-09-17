import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { StdioTransport } from '../src/stdio-transport.js';
import type { UpstreamError } from '../src/protocol.js';

const FAKE = fileURLToPath(new URL('./fake-stdio-server.js', import.meta.url));

function transport(mode: string, deadlineMs = 5000) {
  return new StdioTransport({ command: process.execPath, args: [FAKE, mode], deadlineMs });
}

test('connect performs the handshake and reports the server identity', async () => {
  const stdio = transport('ok');
  try {
    const info = await stdio.connect();
    assert.equal(info.name, 'fake-stdio');
    assert.equal(info.version, '9.9.9');
    assert.equal(info.protocolVersion, '2025-06-18');
    assert.deepEqual(info.capabilities, { tools: {} });
  } finally {
    await stdio.close();
  }
});

test('request round-trips a method and its result', async () => {
  const stdio = transport('ok');
  try {
    await stdio.connect();
    const result = (await stdio.request('tools/list')) as { tools: Array<{ name: string }> };
    assert.deepEqual(
      result.tools.map((tool) => tool.name),
      ['echo'],
    );
  } finally {
    await stdio.close();
  }
});

test('non-JSON banner lines on stdout do not break the framing', async () => {
  const stdio = transport('noisy');
  try {
    assert.equal((await stdio.connect()).name, 'fake-stdio');
  } finally {
    await stdio.close();
  }
});

test('stderr is captured for operator diagnostics', async () => {
  const stdio = transport('noisy');
  try {
    await stdio.connect();
    assert.match(stdio.diagnostics(), /running in fake mode/);
  } finally {
    await stdio.close();
  }
});

test('a hung call rejects on its deadline instead of wedging the queue', async () => {
  const stdio = transport('hang', 50);
  try {
    await stdio.connect();
    await assert.rejects(stdio.request('tools/list'), (error: UpstreamError) => {
      assert.equal(error.code, 'UPSTREAM_TIMEOUT');
      return true;
    });
  } finally {
    await stdio.close();
  }
});

test('a server notification reaches the registered handler', async () => {
  const stdio = transport('notify');
  const seen: string[] = [];
  stdio.onNotification((method) => seen.push(method));
  try {
    await stdio.connect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(seen.includes('notifications/tools/list_changed'), `saw ${JSON.stringify(seen)}`);
  } finally {
    await stdio.close();
  }
});

test('calls in flight when the child is stopped reject as UPSTREAM_DIED', async () => {
  const stdio = transport('hang', 5000);
  await stdio.connect();
  const inFlight = stdio.request('tools/list');
  await stdio.close();
  await assert.rejects(inFlight, (error: UpstreamError) => {
    assert.equal(error.code, 'UPSTREAM_DIED');
    return true;
  });
});
