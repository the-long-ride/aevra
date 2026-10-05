import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createPlatformSleepInhibitor } from '../src/power/platform-sleep-inhibitor.js';

const PARENT_PID = 4242;

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
      parentPid: PARENT_PID,
      spawn(executable: string, args: string[], options: { shell: false }) {
        calls.push({ executable, args: [...args], shell: options.shell });
        return child as any;
      },
    },
  };
}

function decodeWindowsScript(args: string[] | undefined) {
  return Buffer.from(args?.[3] ?? '', 'base64').toString('utf16le');
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
  const script = decodeWindowsScript(calls[0]?.args);
  assert.match(script, /\[uint32\]2147483648/);
  assert.doesNotMatch(script, /\[uint32\]0x80000000/);
  assert.match(
    script,
    /while \(\$true\)[\s\S]*SetThreadExecutionState\(\$ES_CONTINUOUS -bor \$ES_SYSTEM_REQUIRED\)/,
  );
  assert.doesNotMatch(script, /-bor \$ES_DISPLAY_REQUIRED/);
  assert.match(script, /if \(\$state -eq 0\)/);

  await inhibitor.release();
  assert.equal(child.killed, true);
});

test('Windows keep-awake holds the display on when asked so Modern Standby cannot start', async () => {
  const calls: Array<{ executable: string; args: string[]; shell: boolean | undefined }> = [];
  const { deps: injected } = deps(calls);
  const inhibitor = createPlatformSleepInhibitor('win32', injected as any);

  await inhibitor.acquire({ keepDisplayOn: true });

  const script = decodeWindowsScript(calls[0]?.args);
  assert.match(script, /\$ES_DISPLAY_REQUIRED = \[uint32\]0x00000002/);
  assert.match(
    script,
    /SetThreadExecutionState\(\$ES_CONTINUOUS -bor \$ES_SYSTEM_REQUIRED -bor \$ES_DISPLAY_REQUIRED\)/,
  );
});

test('Windows keep-awake helper exits when the Aevra process is gone', async () => {
  const calls: Array<{ executable: string; args: string[]; shell: boolean | undefined }> = [];
  const { deps: injected } = deps(calls);
  const inhibitor = createPlatformSleepInhibitor('win32', injected as any);

  await inhibitor.acquire();

  const script = decodeWindowsScript(calls[0]?.args);
  assert.match(script, new RegExp(`\\$parentPid = ${PARENT_PID}\\b`));
  assert.match(script, /Get-Process -Id \$parentPid -ErrorAction SilentlyContinue\)\) \{ break \}/);
});

test(
  'Windows real keep-awake helper remains alive after initialization',
  { skip: process.platform !== 'win32' },
  async () => {
    const inhibitor = createPlatformSleepInhibitor('win32');
    try {
      await inhibitor.acquire();
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(inhibitor.supported(), true, inhibitor.message());
    } finally {
      await inhibitor.release();
    }
  },
);

test('macOS keep-awake blocks idle and system sleep and exits with Aevra', async () => {
  const calls: Array<{ executable: string; args: string[]; shell: boolean | undefined }> = [];
  const { deps: injected } = deps(calls);
  const inhibitor = createPlatformSleepInhibitor('darwin', injected as any);

  await inhibitor.acquire();

  assert.deepEqual(calls, [
    { executable: 'caffeinate', args: ['-i', '-s', '-w', String(PARENT_PID)], shell: false },
  ]);
});

test('macOS keep-awake adds display assertion when asked', async () => {
  const calls: Array<{ executable: string; args: string[]; shell: boolean | undefined }> = [];
  const { deps: injected } = deps(calls);
  const inhibitor = createPlatformSleepInhibitor('darwin', injected as any);

  await inhibitor.acquire({ keepDisplayOn: true });

  assert.deepEqual(calls[0]?.args, ['-i', '-s', '-d', '-w', String(PARENT_PID)]);
});

test('Linux keep-awake holds a logind inhibitor only while Aevra lives', async () => {
  const calls: Array<{ executable: string; args: string[]; shell: boolean | undefined }> = [];
  const { deps: injected } = deps(calls);
  const inhibitor = createPlatformSleepInhibitor('linux', injected as any);

  await inhibitor.acquire();

  assert.deepEqual(calls, [
    {
      executable: 'systemd-inhibit',
      args: [
        '--what=idle:sleep',
        '--mode=block',
        '--why=Aevra keep awake',
        'tail',
        `--pid=${PARENT_PID}`,
        '-f',
        '/dev/null',
      ],
      shell: false,
    },
  ]);
});

test('changing the display requirement replaces the running helper', async () => {
  const children = [childDouble(), childDouble()];
  let spawnCalls = 0;
  const inhibitor = createPlatformSleepInhibitor('darwin', {
    parentPid: PARENT_PID,
    spawn() {
      const child = children[spawnCalls++];
      if (!child) throw new Error('unexpected extra spawn');
      return child as any;
    },
  } as any);

  await inhibitor.acquire({ keepDisplayOn: false });
  await inhibitor.acquire({ keepDisplayOn: false });
  assert.equal(spawnCalls, 1);

  await inhibitor.acquire({ keepDisplayOn: true });
  assert.equal(spawnCalls, 2);
  assert.equal(children[0]?.killed, true);

  children[0]?.emit('exit', null);
  assert.equal(inhibitor.supported(), true);
  assert.equal(inhibitor.message(), undefined);
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

test('a spawn that throws degrades status without throwing', async () => {
  const inhibitor = createPlatformSleepInhibitor('win32', {
    spawn() {
      throw new Error('spawn powershell.exe EACCES');
    },
  } as any);

  await inhibitor.acquire();

  assert.equal(inhibitor.supported(), false);
  assert.match(inhibitor.message() ?? '', /EACCES/);
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
