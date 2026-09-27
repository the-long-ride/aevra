import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectSystemCapabilities,
  fallbackSystemCapabilitySnapshot,
  type CapabilityProbeResult,
} from '../src/system/capability-detector.js';

type Reply = Partial<CapabilityProbeResult> | Error;
const ok = (stdout: string, stderr = ''): Reply => ({
  exitCode: 0,
  stdout,
  stderr,
  timedOut: false,
});
const now = () => new Date('2026-01-02T03:04:05.000Z');

function runner(replies: Record<string, Reply>) {
  const calls: string[] = [];
  return {
    calls,
    run: async (executable: string, args: readonly string[]) => {
      const key = `${executable} ${args.join(' ')}`;
      calls.push(key);
      const reply = replies[key] ?? replies[executable];
      if (reply instanceof Error) throw reply;
      return {
        exitCode: 1,
        stdout: '',
        stderr: '',
        timedOut: false,
        ...(reply ?? {}),
      } as CapabilityProbeResult;
    },
  };
}

async function detect(
  platform: NodeJS.Platform,
  replies: Record<string, Reply>,
  env: NodeJS.ProcessEnv = {},
  release = '6.1',
) {
  const r = runner(replies);
  const snapshot = await detectSystemCapabilities({
    platform,
    env,
    release,
    arch: 'x64',
    runner: r,
    now,
  });
  const tool = (id: string) => snapshot.toolchains.find((item) => item.id === id);
  return { snapshot, tool, calls: r.calls };
}

test('tool probes parse versions from stdout, stderr, or neither', async () => {
  const { tool } = await detect('linux', {
    git: ok('git version 2.53.0\n'),
    node: ok('\n\u0007  v24.1.0-rc.1  \n'),
    java: ok('', 'openjdk version "21.0.2" 2024-01-16'),
    uv: ok('uv without number'),
    cargo: ok(''),
    rustc: { exitCode: 0, stdout: 'rustc 1.96.0', timedOut: true },
    cmake: { exitCode: 2, stdout: 'cmake version 4.3.2' },
    gcc: new Error('spawn failure'),
  });
  assert.deepEqual(tool('git'), {
    id: 'git',
    label: 'Git',
    category: 'source-control',
    available: true,
    executable: 'git',
    version: '2.53.0',
  });
  assert.equal(tool('node')!.version, '24.1.0-rc.1');
  assert.equal(tool('java')!.version, '21.0.2');
  assert.equal(tool('uv')!.available, true);
  assert.equal('version' in tool('uv')!, false);
  assert.equal('version' in tool('cargo')!, false);
  assert.deepEqual(tool('rustc'), {
    id: 'rustc',
    label: 'Rust',
    category: 'rust',
    available: false,
  });
  assert.equal(tool('cmake')!.available, false);
  assert.equal(tool('gcc')!.available, false);
});

test('windows package managers fall back to cmd.exe shims and report the .cmd name', async () => {
  const { tool, calls } = await detect('win32', {
    'cmd.exe /d /s /c npm --version': ok('11.0.0'),
    npx: new Error('not found'),
    'cmd.exe /d /s /c npx --version': ok('11.0.0'),
  });
  assert.equal(tool('npm')!.executable, 'npm.cmd');
  assert.equal(tool('npx')!.executable, 'npx.cmd');
  assert.equal(tool('pnpm')!.available, false);
  assert.ok(calls.includes('cmd.exe /d /s /c yarn --version'));
  const linux = await detect('linux', {});
  assert.equal(
    linux.calls.some((call) => call.startsWith('cmd.exe')),
    false,
  );
});

test('windows shell recommendation prefers pwsh, then powershell, then cmd', async () => {
  const pick = async (replies: Record<string, Reply>) =>
    (await detect('win32', replies)).snapshot.os.recommendedShell;
  assert.equal(
    await pick({ pwsh: ok('PowerShell 7.6.5'), cmd: ok('Microsoft Windows [Version 10.0.26200]') }),
    'pwsh',
  );
  assert.equal(await pick({ powershell: ok('5.1.26100'), cmd: ok('ver') }), 'powershell');
  assert.equal(await pick({ cmd: ok('Microsoft Windows') }), 'cmd');
  assert.equal(await pick({}), null);
  const { snapshot } = await detect('win32', {
    cmd: ok('Microsoft Windows [Version 10.0.26200]'),
    bash: new Error('none'),
  });
  assert.deepEqual(snapshot.os.availableShells, [
    { id: 'cmd', label: 'Command Prompt', version: '10.0.26200' },
  ]);
  assert.equal(snapshot.os.platform, 'windows');
  assert.equal(snapshot.os.platformDetail, 'Windows kernel 6.1');
});

test('unix shell recommendation honours $SHELL, then platform priority', async () => {
  const shells = { bash: ok('GNU bash, version 5.2'), zsh: ok('zsh 5.9'), sh: ok('') };
  const mac = await detect('darwin', shells, { SHELL: '/bin/bash' });
  assert.equal(mac.snapshot.os.recommendedShell, 'bash');
  assert.equal(mac.snapshot.os.platform, 'macos');
  assert.equal(mac.snapshot.os.platformDetail, 'macOS kernel 6.1');
  assert.equal(
    (await detect('darwin', shells, { SHELL: '/usr/bin/fish' })).snapshot.os.recommendedShell,
    'zsh',
  );
  assert.equal(
    (await detect('darwin', { sh: ok('') }, { SHELL: '/bin/zsh' })).snapshot.os.recommendedShell,
    'sh',
  );
  const linux = await detect('linux', shells);
  assert.equal(linux.snapshot.os.recommendedShell, 'bash');
  assert.equal(linux.snapshot.os.platformDetail, 'Linux kernel 6.1');
  assert.equal((await detect('linux', {})).snapshot.os.recommendedShell, null);
  const other = await detect('freebsd', shells, {}, ' 14.0\u0001 ');
  assert.equal(other.snapshot.os.recommendedShell, null);
  assert.equal(other.snapshot.os.platform, 'other');
  assert.equal(other.snapshot.os.platformDetail, '14.0');
});

test('fallback snapshot omits detail for blank releases and uses defaults', () => {
  const blank = fallbackSystemCapabilitySnapshot({
    platform: 'linux',
    release: '\u0000  ',
    arch: 'arm64',
    now,
  });
  assert.deepEqual(blank, {
    scope: 'host',
    detectedAt: '2026-01-02T03:04:05.000Z',
    os: { platform: 'linux', arch: 'arm64', recommendedShell: null, availableShells: [] },
    toolchains: [],
  });
  const defaults = fallbackSystemCapabilitySnapshot();
  assert.equal(defaults.os.arch, process.arch);
  assert.equal(Number.isFinite(Date.parse(defaults.detectedAt)), true);
});
