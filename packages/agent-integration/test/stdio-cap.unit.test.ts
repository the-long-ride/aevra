import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { runStdio } from '../src/stdio.js';

test('at the in-flight cap stdin is still read: cancellations apply and queued requests drop', async () => {
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough();
  let out = '';
  stdout.on('data', (b) => (out += b));
  const sent: unknown[] = [];
  const running = runStdio(
    { stdin, stdout, stderr },
    {
      send(message, _emit, signal) {
        const id = (message as { id?: unknown }).id;
        if (id === undefined) return Promise.resolve();
        sent.push(id);
        return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      },
    },
  );
  const line = (value: unknown) => JSON.stringify(value) + '\n';
  for (let id = 1; id <= 33; id++) stdin.write(line({ jsonrpc: '2.0', id, method: 'tools/call' }));
  const cancel = (requestId: number) =>
    line({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId } });
  stdin.write(cancel(33));
  for (let id = 1; id <= 32; id++) stdin.write(cancel(id));
  stdin.end();
  const settled = await Promise.race([
    running.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  assert.equal(settled, true, 'cancellations were read at the cap');
  assert.equal(sent.includes(33), false);
  assert.equal(out, '');
});
