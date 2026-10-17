import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { DEFAULT_REQUEST_TIMEOUT_MS, runStdio } from '../src/stdio.js';

test('stdio preserves concurrent IDs, notifications, partial lines and cancellation without banners', async () => {
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough();
  let output = '';
  stdout.on('data', (chunk) => {
    output += chunk;
  });
  const seen: unknown[] = [];
  const pending = runStdio(
    { stdin, stdout, stderr },
    {
      async send(message: any, emit, signal) {
        seen.push(message);
        if (message.id === 2)
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true }),
          );
        if (message.id !== undefined)
          await emit({ jsonrpc: '2.0', id: message.id, result: { ok: true } });
      },
    },
  );
  stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize"');
  stdin.write('}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/call"}\n');
  await new Promise((resolve) => setTimeout(resolve, 20));
  stdin.end('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2}}\n');
  assert.equal(await pending, 0);
  assert.equal(seen.length, 4);
  assert.deepEqual(
    output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).id)
      .sort(),
    [1, 2],
  );
});

test('stdio reports invalid JSON and oversized lines, then accepts a following valid request', async () => {
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough();
  let output = '';
  stdout.on('data', (chunk) => {
    output += chunk;
  });
  const pending = runStdio(
    { stdin, stdout, stderr },
    {
      async send(message: any, emit) {
        await emit({ jsonrpc: '2.0', id: message.id, result: {} });
      },
    },
    { maxLineBytes: 64 },
  );
  stdin.end('invalid\n' + 'x'.repeat(100) + '\n{"jsonrpc":"2.0","id":3,"method":"ping"}\n');
  assert.equal(await pending, 0);
  const messages = output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(messages[0].error.code, -32700);
  assert.equal(messages[1].error.code, -32600);
  assert.equal(messages[2].id, 3);
});

test('default request timeout is ten minutes and a short override still aborts', async () => {
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 600_000);
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough();
  let output = '';
  stdout.on('data', (chunk) => {
    output += chunk;
  });
  const pending = runStdio(
    { stdin, stdout, stderr },
    {
      async send(_message: any, _emit, signal) {
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        );
      },
    },
    { timeoutMs: 20 },
  );
  stdin.end('{"jsonrpc":"2.0","id":7,"method":"tools/call"}\n');
  assert.equal(await pending, 0);
  const message = JSON.parse(output.trim());
  assert.equal(message.id, 7);
  assert.equal(message.error.code, -32000);
  assert.equal(message.error.message, 'Request cancelled or timed out');
});
