import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserSessionRegistry } from '../src/registry.js';
import { FakeDriver } from './fake-driver.js';

function registry() {
  return new BrowserSessionRegistry({
    async createDriver(options) {
      return new FakeDriver(options.transport);
    },
    extensionPaired: () => true,
    async teardownExtension() {},
  });
}

test('two operations submitted at once do not interleave', async () => {
  const subject = registry();
  await subject.connect({ transport: 'extension' });
  const order: string[] = [];

  const slow = subject.run(async () => {
    order.push('a:start');
    await new Promise((resolve) => setTimeout(resolve, 30));
    order.push('a:end');
  });
  const fast = subject.run(async () => {
    order.push('b:start');
    order.push('b:end');
  });
  await Promise.all([slow, fast]);

  // The failure this pins: without the queue the order is a:start, b:start,
  // b:end, a:end - two act batches clicking into the same tab at once.
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('an operation that throws does not poison the ones queued behind it', async () => {
  const subject = registry();
  await subject.connect({ transport: 'extension' });

  const failed = subject.run(async () => {
    throw new Error('page went away');
  });
  const after = subject.run(async (driver) => driver.transport);

  await assert.rejects(() => failed, /page went away/);
  assert.equal(await after, 'extension');
});

test('run refuses when no session is connected', async () => {
  const subject = registry();
  await assert.rejects(() => subject.run(async () => 'never'), /BROWSER_NOT_CONNECTED/);
});

test('a disconnect while work is queued refuses the queued work rather than acting', async () => {
  const subject = registry();
  await subject.connect({ transport: 'extension' });

  let announce = () => {};
  const running = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const held = subject.run(async () => {
    announce();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return 'first';
  });
  // Waited for deliberately: work that has not started yet has resolved no
  // driver, so it would be refused like anything else still queued. What this
  // case pins is that work already in flight keeps the driver it acquired.
  await running;
  const queued = subject.run(async (driver) => driver.transport);
  // The kill switch deliberately does not wait for the queue: it has to reach a
  // wedged session, so work still queued finds no driver and is refused.
  await subject.disconnect();

  assert.equal(await held, 'first');
  await assert.rejects(() => queued, /BROWSER_NOT_CONNECTED/);
});

test('operations run in submission order across many callers', async () => {
  const subject = registry();
  await subject.connect({ transport: 'extension' });
  const seen: number[] = [];
  await Promise.all(
    [0, 1, 2, 3, 4].map((index) =>
      subject.run(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5 - index));
        seen.push(index);
      }),
    ),
  );
  assert.deepEqual(seen, [0, 1, 2, 3, 4]);
});
