import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough, Writable } from 'node:stream';
import { runStdio } from '../src/stdio.js';

function brokenPipe() {
  const stdin = new PassThrough();
  const stderr = new PassThrough();
  const stdout = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error('the agent closed its end of the pipe'));
    },
  });
  return { stdin, stdout, stderr };
}

async function withoutUnhandled(run: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', record);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.off('unhandledRejection', record);
  }
  return unhandled;
}

for (const open of [false, true])
  test(`a broken stdout ends the bridge with exit 1 and no unhandled rejection (stdin ${open ? 'open' : 'ended'})`, async () => {
    const io = brokenPipe();
    const unhandled = await withoutUnhandled(async () => {
      const running = runStdio(io, { async send() {} });
      if (open) io.stdin.write('not json\n[1]\n');
      else io.stdin.end('not json\n[1]\n');
      assert.equal(await running, 1);
    });
    assert.deepEqual(unhandled, []);
  });
