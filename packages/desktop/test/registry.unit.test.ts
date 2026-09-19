import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopSessionRegistry } from '../src/registry.js';
import { FakeDesktopDriver } from './fake-driver.js';

function registry() {
  const driver = new FakeDesktopDriver({
    capture: true,
    tree: true,
    attribution: true,
    input: true,
  });
  return new DesktopSessionRegistry({ createDriver: async () => driver });
}

test('operations serialize: the second waits for the first', async () => {
  const target = registry();
  await target.connect();
  const order: string[] = [];
  let releaseFirst: () => void = () => {};
  const firstStarted = new Promise<void>((resolve) => {
    void target.run(async () => {
      order.push('first-start');
      resolve();
      await new Promise<void>((done) => (releaseFirst = done));
      order.push('first-end');
    });
  });
  // Wait until the first operation is genuinely in flight, otherwise both would
  // queue behind an idle chain and prove nothing.
  await firstStarted;
  const second = target.run(async () => {
    order.push('second-start');
  });
  releaseFirst();
  await second;
  assert.deepEqual(order, ['first-start', 'first-end', 'second-start']);
});

test('a rejected operation does not poison the queue', async () => {
  const target = registry();
  await target.connect();
  await assert.rejects(() =>
    target.run(async () => {
      throw new Error('boom');
    }),
  );
  assert.equal(await target.run(async () => 'ok'), 'ok');
});

test('run before connect reports DESKTOP_NOT_CONNECTED', async () => {
  await assert.rejects(() => registry().run(async () => 'x'), /DESKTOP_NOT_CONNECTED/);
});

test('queued operation cannot migrate to a new driver after disconnect', async () => {
  const target = registry();
  await target.connect();
  let releaseFirst: () => void = () => {};
  const firstStarted = new Promise<void>((resolve) => {
    void target.run(async () => {
      resolve();
      await new Promise<void>((done) => (releaseFirst = done));
    });
  });
  await firstStarted;

  // Queue a second operation while the first is running
  const second = target.run(async () => 'migrated');

  // Disconnect mid-flight advances epoch and tears down session
  await target.disconnect();
  releaseFirst();

  // The queued operation must reject because epoch changed
  await assert.rejects(() => second, /DESKTOP_NOT_CONNECTED/);
});
