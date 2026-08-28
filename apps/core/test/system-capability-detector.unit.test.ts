import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectSystemCapabilities,
  type CapabilityProbeResult,
  type CapabilityProbeRunner,
} from '../src/system/capability-detector.js';
import { createCachedSystemCapabilityResolver } from '../src/runtime-support.js';

function fakeRunner(values: Record<string, string | CapabilityProbeResult>): CapabilityProbeRunner {
  return {
    async run(executable) {
      const value = values[executable];
      if (value === undefined) {
        return { exitCode: null, stdout: '', stderr: '', timedOut: false };
      }
      if (typeof value === 'string') {
        return { exitCode: 0, stdout: value, stderr: '', timedOut: false };
      }
      return value;
    },
  };
}

test('Windows recommends pwsh before Windows PowerShell and cmd', async () => {
  const snapshot = await detectSystemCapabilities({
    platform: 'win32',
    arch: 'x64',
    env: {},
    release: '10.0.26100',
    runner: fakeRunner({
      pwsh: 'PowerShell 7.5.2',
      powershell: '5.1.26100.1',
      cmd: 'Microsoft Windows [Version 10.0.26100.0]',
    }),
    now: () => new Date('2026-08-27T12:00:00.000Z'),
  });

  assert.equal(snapshot.detectedAt, '2026-08-27T12:00:00.000Z');
  assert.equal(snapshot.os.platform, 'windows');
  assert.equal(snapshot.os.platformDetail, 'Windows kernel 10.0.26100');
  assert.equal(snapshot.os.arch, 'x64');
  assert.equal(snapshot.os.recommendedShell, 'pwsh');
  assert.deepEqual(
    snapshot.os.availableShells.map((shell) => shell.id),
    ['pwsh', 'powershell', 'cmd'],
  );
});

test('macOS and Linux prefer the current recognized detected shell basename', async () => {
  const linux = await detectSystemCapabilities({
    platform: 'linux',
    arch: 'arm64',
    env: { SHELL: '/usr/bin/bash' },
    release: '6.8.0',
    runner: fakeRunner({ bash: 'GNU bash, version 5.2.0', zsh: 'zsh 5.9', sh: 'sh 1.0' }),
  });
  assert.equal(linux.os.platform, 'linux');
  assert.equal(linux.os.recommendedShell, 'bash');

  const macos = await detectSystemCapabilities({
    platform: 'darwin',
    arch: 'arm64',
    env: { SHELL: '/bin/zsh' },
    release: '25.0.0',
    runner: fakeRunner({ zsh: 'zsh 5.9', bash: 'GNU bash, version 3.2.57' }),
  });
  assert.equal(macos.os.platform, 'macos');
  assert.equal(macos.os.platformDetail, 'macOS kernel 25.0.0');
  assert.equal(macos.os.recommendedShell, 'zsh');
});

test('Windows reports WSL but never selects it as the recommended shell', async () => {
  const snapshot = await detectSystemCapabilities({
    platform: 'win32',
    arch: 'x64',
    env: {},
    runner: fakeRunner({ wsl: 'Default Distribution: Ubuntu' }),
  });

  assert.deepEqual(
    snapshot.os.availableShells.map((shell) => shell.id),
    ['wsl'],
  );
  assert.equal(snapshot.os.recommendedShell, null);
});

test('Python aliases are normalized and successful candidate name is retained', async () => {
  const snapshot = await detectSystemCapabilities({
    platform: 'linux',
    arch: 'x64',
    env: {},
    runner: fakeRunner({ python3: 'Python 3.13.2', pip3: 'pip 25.1 from ignored/site-packages' }),
  });

  const python = snapshot.toolchains.find((tool) => tool.id === 'python');
  const pip = snapshot.toolchains.find((tool) => tool.id === 'pip');
  assert.deepEqual(python, {
    id: 'python',
    label: 'Python',
    category: 'python',
    available: true,
    executable: 'python3',
    version: '3.13.2',
  });
  assert.equal(pip?.executable, 'pip3');
  assert.equal(pip?.available, true);
});

test('failed probes do not abort later probes and unavailable tools expose no path', async () => {
  const snapshot = await detectSystemCapabilities({
    platform: 'linux',
    arch: 'x64',
    env: {},
    runner: fakeRunner({
      git: { exitCode: 2, stdout: '', stderr: 'failure', timedOut: false },
      node: 'v24.7.0',
      cargo: { exitCode: null, stdout: '', stderr: '', timedOut: true },
    }),
  });

  assert.equal(snapshot.toolchains.find((tool) => tool.id === 'git')?.available, false);
  assert.equal(snapshot.toolchains.find((tool) => tool.id === 'node')?.version, '24.7.0');
  assert.equal(snapshot.toolchains.find((tool) => tool.id === 'cargo')?.available, false);
  assert.equal(snapshot.toolchains.find((tool) => tool.id === 'git')?.executable, undefined);
});

test('POSIX sh uses a portable command probe and Windows package managers use cmd.exe launchers', async () => {
  const calls: Array<{ executable: string; args: readonly string[] }> = [];
  const runner: CapabilityProbeRunner = {
    async run(executable, args) {
      calls.push({ executable, args });
      if (executable === 'sh') {
        return {
          exitCode: args.join(' ') === '-c exit 0' ? 0 : 2,
          stdout: '',
          stderr: '',
          timedOut: false,
        };
      }
      if (executable === 'cmd.exe' && args.join(' ') === '/d /s /c npm --version') {
        return { exitCode: 0, stdout: '10.9.0', stderr: '', timedOut: false };
      }
      return { exitCode: null, stdout: '', stderr: '', timedOut: false };
    },
  };
  const linux = await detectSystemCapabilities({ platform: 'linux', env: {}, runner });
  assert.ok(linux.os.availableShells.some((shell) => shell.id === 'sh'));
  const windows = await detectSystemCapabilities({ platform: 'win32', env: {}, runner });
  assert.equal(windows.toolchains.find((tool) => tool.id === 'npm')?.executable, 'npm.cmd');
  assert.ok(
    calls.some(
      (call) => call.executable === 'cmd.exe' && call.args.join(' ') === '/d /s /c npm --version',
    ),
  );
  assert.ok(calls.some((call) => call.executable === 'sh' && call.args.join(' ') === '-c exit 0'));
});

test('serialized snapshot omits sensitive environment values and bounds normalized output', async () => {
  const sentinel = 'sentinel-secret-user';
  const snapshot = await detectSystemCapabilities({
    platform: 'linux',
    arch: 'x64',
    release: '6.8.0',
    env: {
      HOME: `/home/${sentinel}`,
      USERPROFILE: `C:\\Users\\${sentinel}`,
      HOSTNAME: 'sentinel-host',
      SHELL: '/usr/bin/zsh',
    },
    runner: fakeRunner({
      zsh: 'zsh 5.9',
      git: `git version 2.51.0 ${'x'.repeat(500)}`,
    }),
  });

  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(sentinel), false);
  assert.equal(serialized.includes('sentinel-host'), false);
  assert.equal(serialized.includes('/usr/bin/zsh'), false);
  assert.equal(serialized.includes('C:\\Users'), false);
  assert.equal(snapshot.os.recommendedShell, 'zsh');
  assert.ok((snapshot.toolchains.find((tool) => tool.id === 'git')?.version?.length ?? 0) <= 160);
});

test('runtime capability resolver shares one host scan across concurrent callers', async () => {
  let scans = 0;
  const expected = {
    detectedAt: '2026-08-27T12:00:00.000Z',
    os: {
      platform: 'linux',
      arch: 'x64',
      recommendedShell: null,
      availableShells: [],
    },
    toolchains: [],
  } as const;
  const resolve = createCachedSystemCapabilityResolver(async () => {
    scans += 1;
    await Promise.resolve();
    return expected;
  });

  const [first, second] = await Promise.all([resolve(), resolve()]);
  const third = await resolve();

  assert.equal(scans, 1);
  assert.equal(first, expected);
  assert.equal(second, expected);
  assert.equal(third, expected);
});
