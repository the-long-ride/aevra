import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserSessionRegistry } from '../src/registry.js';
import { FakeDriver } from './fake-driver.js';

function registry() {
  const created: FakeDriver[] = [];
  let paired = true;
  let tornDown = 0;
  const subject = new BrowserSessionRegistry({
    async createDriver(options) {
      const driver = new FakeDriver(options.transport);
      created.push(driver);
      return driver;
    },
    extensionPaired: () => paired,
    async teardownExtension() {
      tornDown += 1;
      paired = false;
    },
  });
  return { subject, created, tornDownCount: () => tornDown };
}

test('require throws BROWSER_NOT_CONNECTED before any connect', () => {
  const { subject } = registry();
  assert.throws(() => subject.require(), /BROWSER_NOT_CONNECTED/);
});

test('connect installs a driver that require then returns', async () => {
  const { subject } = registry();
  const info = await subject.connect({ transport: 'cdp', cdpPort: 9222 });
  assert.equal(info.transport, 'cdp');
  assert.equal(subject.require().transport, 'cdp');
});

test('a second connect disconnects the first driver', async () => {
  const { subject, created } = registry();
  await subject.connect({ transport: 'cdp', cdpPort: 9222 });
  await subject.connect({ transport: 'extension' });
  assert.equal(created.length, 2);
  assert.equal(created[0]!.disconnected, true);
  assert.equal(created[1]!.disconnected, false);
});

test('status reports the live transport and tabs when connected', async () => {
  const { subject } = registry();
  await subject.connect({ transport: 'cdp', cdpPort: 9222 });
  const status = await subject.status();
  assert.equal(status.connected, true);
  assert.equal(status.transport, 'cdp');
  assert.ok(status.tabs.length >= 1);
  assert.ok(status.tabs.every((tab) => typeof tab.originClass === 'string'));
});

test('status reports a disconnected registry without throwing', async () => {
  const { subject } = registry();
  const status = await subject.status();
  assert.deepEqual(status, {
    connected: false,
    transport: null,
    epoch: 0,
    extensionPaired: true,
    tabs: [],
  });
});

test('a fresh registry is uninitialised and adopts the first epoch it is told', async () => {
  const state = registry();
  assert.equal(state.subject.initialised(), false);
  await state.subject.connect({ transport: 'extension' });
  // Core's persisted epoch starts at 1. Adoption is not a revocation: nothing
  // was ever issued at the old value, so nothing is torn down.
  await state.subject.setEpoch(1);
  assert.equal(state.subject.initialised(), true);
  assert.equal(state.subject.epoch(), 1);
  assert.equal(state.tornDownCount(), 0);
  assert.equal(state.created[0]!.disconnected, false);
});

test('bumping the epoch tears down the driver and the extension peer', async () => {
  const state = registry();
  await state.subject.setEpoch(1);
  await state.subject.connect({ transport: 'extension' });
  await state.subject.setEpoch(2);
  assert.equal(state.created[0]!.disconnected, true);
  assert.equal(state.tornDownCount(), 1);
  assert.equal(state.subject.epoch(), 2);
  assert.throws(() => state.subject.require(), /BROWSER_NOT_CONNECTED/);
});

test('a stale epoch is ignored so out-of-order pushes cannot resurrect a token', async () => {
  const { subject } = registry();
  await subject.setEpoch(5);
  await subject.setEpoch(3);
  assert.equal(subject.epoch(), 5);
});

test('adoption happens once: a lower epoch after it is still refused', async () => {
  const { subject } = registry();
  await subject.setEpoch(7);
  for (const stale of [6, 0, -1]) {
    await subject.setEpoch(stale);
    assert.equal(subject.epoch(), 7, `epoch after setEpoch(${stale})`);
  }
});

test('a non-integer epoch never initialises the registry', async () => {
  const { subject } = registry();
  await subject.setEpoch(Number.NaN);
  assert.equal(subject.initialised(), false);
});

test('a driver that throws on disconnect does not wedge the registry', async () => {
  const { subject, created } = registry();
  await subject.connect({ transport: 'cdp', cdpPort: 9222 });
  created[0]!.failDisconnect = true;
  await subject.disconnect();
  assert.throws(() => subject.require(), /BROWSER_NOT_CONNECTED/);
});
