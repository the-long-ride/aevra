import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createPlatformSleepInhibitor } from '../src/power/platform-sleep-inhibitor.js';

function childDouble() {
  const child = new EventEmitter() as EventEmitter & {
    killed: boolean;
    kill(signal?: NodeJS.Signals): boolean;
  };
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

function deps(calls: Array<{ executable: string; args: string[]; shell: boolean | undefined }>) {
  const child = childDouble();
  return {
    child,
    deps: {
      spawn(executable: string, args: string[], options: { shell: false }) {
        calls.push({ executable, args: [...args], shell: options.shell });
        return child as any;
      },
    },
  };
}

test('Windows keep-awake uses SetThreadExecutionState without forcing the display on', async () => {
  const calls: Array<{ executable: string; args: string[]; shell: boolean | undefined }> = [];
  const { child, deps: injected } = deps(calls);
  const inhibitor = createPlatformSleepInhibitor('win32', injected as any);

  await inhibitor.acquire();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.executable, 'powershell.exe');
  assert.deepEqual(calls[0]?.args.slice(0, 3), [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
  ]);
  assert.equal(calls[0]?.shell, false);
  const encoded = calls[0]?.args[3] ?? '';
  const script = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.match(script, /SetThreadExecutionState/);
  assert.match(script, /ES_SYSTEM_REQUIRED/);
  assert.doesNotMatch(script, /ES_DISPLAY_REQUIRED/);

  await inhibitor.release();
  assert.equal(child.killed, true);
});

test('macOS keep-awake uses caffeinate idle-sleep inhibition only', async () => {
  const calls: Array<{ executable: string; args: string[]; shell: boolean | undefined }> = [];
  const { deps: injected } = deps(calls);
  const inhibitor = createPlatformSleepInhibitor('darwin', injected as any);

  await inhibitor.acquire();

  assert.deepEqual(calls, [{ executable: 'caffeinate', args: ['-i'], shell: false }]);
});

test('Linux keep-awake uses a logind idle inhibitor without shell interpolation', async () => {
  const calls: Array<{ executable: string; args: string[]; shell: boolean | undefined }> = [];
  const { deps: injected } = deps(calls);
  const inhibitor = createPlatformSleepInhibitor('linux', injected as any);

  await inhibitor.acquire();

  assert.deepEqual(calls, [
    {
      executable: 'systemd-inhibit',
      args: ['--what=idle', '--mode=block', '--why=Aevra keep awake', 'sleep', 'infinity'],
      shell: false,
    },
  ]);
});

test('acquire and release are idempotent and child startup errors degrade safely', async () => {
  const calls: Array<{ executable: string; args: string[]; shell: boolean | undefined }> = [];
  const { child, deps: injected } = deps(calls);
  const inhibitor = createPlatformSleepInhibitor('linux', injected as any);

  await inhibitor.acquire();
  await inhibitor.acquire();
  assert.equal(calls.length, 1);

  child.emit('error', new Error('spawn systemd-inhibit ENOENT'));
  assert.equal(inhibitor.supported(), false);
  assert.match(inhibitor.message() ?? '', /ENOENT/);

  await inhibitor.release();
  await inhibitor.release();
});

test('unexpected helper exit is reported and a later acquire starts a fresh inhibitor', async () => {
  const children = [childDouble(), childDouble()];
  let spawnCalls = 0;
  const inhibitor = createPlatformSleepInhibitor('linux', {
    spawn() {
      const child = children[spawnCalls++];
      if (!child) throw new Error('unexpected extra spawn');
      return child as any;
    },
  } as any);

  await inhibitor.acquire();
  children[0]?.emit('exit', 1);

  assert.equal(inhibitor.supported(), false);
  assert.match(inhibitor.message() ?? '', /exited unexpectedly/i);

  await inhibitor.acquire();
  assert.equal(spawnCalls, 2);
  assert.equal(inhibitor.supported(), true);
  assert.equal(inhibitor.message(), undefined);
});
test('unsupported platforms report unavailable without throwing', async () => {
  const inhibitor = createPlatformSleepInhibitor('aix', {
    spawn() {
      throw new Error('should not spawn');
    },
  } as any);

  assert.equal(inhibitor.supported(), false);
  assert.match(inhibitor.message() ?? '', /not supported/i);

  await inhibitor.acquire();

  assert.equal(inhibitor.supported(), false);
  assert.match(inhibitor.message() ?? '', /not supported/i);
});
