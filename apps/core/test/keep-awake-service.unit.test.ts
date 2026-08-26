import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KeepAwakeService,
  countKeepAwakeManagedProcesses,
  countKeepAwakeRemoteConnections,
} from '../src/power/keep-awake-service.js';

function settingsDouble(initial?: unknown) {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set('power.keepAwake', initial);
  return {
    values,
    get<T>(key: string, fallback: T): T {
      return (values.has(key) ? values.get(key) : fallback) as T;
    },
    set(key: string, value: unknown) {
      values.set(key, value);
    },
  };
}

function inhibitorDouble() {
  let supported = true;
  let message: string | undefined;
  let acquired = false;
  let acquireCalls = 0;
  let releaseCalls = 0;
  return {
    get acquired() {
      return acquired;
    },
    get acquireCalls() {
      return acquireCalls;
    },
    get releaseCalls() {
      return releaseCalls;
    },
    setFailure(value: string) {
      supported = false;
      message = value;
      acquired = false;
    },
    async acquire() {
      acquireCalls += 1;
      if (supported) acquired = true;
    },
    async release() {
      releaseCalls += 1;
      acquired = false;
    },
    supported() {
      return supported;
    },
    message() {
      return message;
    },
  };
}

test('defaults to remote connections and inhibits while a remote connection is connected or in grace', async () => {
  const settings = settingsDouble();
  const inhibitor = inhibitorDouble();
  let remoteConnections = 0;
  const service = new KeepAwakeService(
    settings as any,
    inhibitor,
    {
      remoteConnectionCount: () => remoteConnections,
      managedProcessCount: () => 0,
    },
    { platform: 'win32' },
  );

  await service.refresh();
  assert.deepEqual(service.status(), {
    mode: 'remote-connections',
    active: false,
    supported: true,
    platform: 'win32',
    reason: 'No matching activity',
    remoteConnections: 0,
    managedProcesses: 0,
  });

  remoteConnections = 2;
  await service.refresh();
  assert.equal(inhibitor.acquired, true);
  assert.equal(service.status().active, true);
  assert.equal(service.status().reason, '2 remote connections');
});

test('configure validates and persists modes while refreshing immediately', async () => {
  const settings = settingsDouble();
  const inhibitor = inhibitorDouble();
  let managedProcesses = 1;
  const service = new KeepAwakeService(
    settings as any,
    inhibitor,
    {
      remoteConnectionCount: () => 0,
      managedProcessCount: () => managedProcesses,
    },
    { platform: 'linux' },
  );

  const managed = await service.configure('managed-processes');
  assert.deepEqual(settings.values.get('power.keepAwake'), { mode: 'managed-processes' });
  assert.equal(managed.active, true);
  assert.equal(managed.reason, '1 managed process');

  managedProcesses = 0;
  const always = await service.configure('always');
  assert.equal(always.active, true);
  assert.equal(always.reason, 'Aevra is running');

  const off = await service.configure('off');
  assert.equal(off.active, false);
  assert.equal(off.reason, 'Disabled');
  assert.equal(inhibitor.acquired, false);

  await assert.rejects(() => service.configure('invalid' as any), /Invalid keep awake mode/);
});

test('start evaluates immediately and close clears polling and releases inhibition', async () => {
  const settings = settingsDouble({ mode: 'always' });
  const inhibitor = inhibitorDouble();
  let intervalHandler: (() => void) | undefined;
  let cleared = false;
  let unrefed = false;
  const service = new KeepAwakeService(
    settings as any,
    inhibitor,
    { remoteConnectionCount: () => 0, managedProcessCount: () => 0 },
    {
      platform: 'darwin',
      setInterval(handler: any) {
        intervalHandler = handler;
        return { unref: () => (unrefed = true) } as any;
      },
      clearInterval() {
        cleared = true;
      },
    },
  );

  await service.start();
  assert.equal(inhibitor.acquired, true);
  assert.equal(unrefed, true);
  assert.equal(typeof intervalHandler, 'function');

  intervalHandler?.();
  await Promise.resolve();

  await service.close();
  assert.equal(cleared, true);
  assert.equal(inhibitor.acquired, false);
  assert.ok(inhibitor.releaseCalls >= 1);
});

test('status reflects an asynchronous inhibitor failure before the next policy poll', async () => {
  const settings = settingsDouble();
  const inhibitor = inhibitorDouble();
  const service = new KeepAwakeService(
    settings as any,
    inhibitor,
    { remoteConnectionCount: () => 1, managedProcessCount: () => 0 },
    { platform: 'win32' },
  );

  await service.refresh();
  assert.equal(service.status().active, true);

  inhibitor.setFailure('keep awake helper exited');
  const status = service.status();
  assert.equal(status.active, false);
  assert.equal(status.supported, false);
  assert.equal(status.message, 'keep awake helper exited');
});
test('platform acquisition failure degrades status without throwing', async () => {
  const settings = settingsDouble({ mode: 'always' });
  const inhibitor = inhibitorDouble();
  inhibitor.setFailure('spawn systemd-inhibit ENOENT');
  const service = new KeepAwakeService(
    settings as any,
    inhibitor,
    { remoteConnectionCount: () => 0, managedProcessCount: () => 0 },
    { platform: 'linux' },
  );

  await service.refresh();

  assert.equal(service.status().active, false);
  assert.equal(service.status().supported, false);
  assert.match(service.status().message ?? '', /ENOENT/);
});

test('counts only connected and grace remote connections plus known running managed processes', () => {
  assert.equal(
    countKeepAwakeRemoteConnections([
      { status: 'CONNECTED' },
      { status: 'GRACE' },
      { status: 'OFFLINE' },
      { status: 'REVOKED' },
    ]),
    2,
  );
  assert.equal(
    countKeepAwakeManagedProcesses([
      { state: 'running', ownership: 'owned' },
      { state: 'running', ownership: 'detached-uncertain' },
      { state: 'completed', ownership: 'owned' },
    ]),
    1,
  );
});
