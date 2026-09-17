import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { BoundedLog, ManagedProcessRuntime, verifyReAdoption } from '../src/processes.js';
import { resolveExecutable, windowsShimCommand } from '../src/spawn-target.js';

test('bounded log evicts oldest lines', () => {
  const l = new BoundedLog(2);
  l.append('a\nb\nc\n');
  assert.deepEqual(l.read().lines, ['b', 'c']);
});

test('managed process reports completed terminal state and exit code', async () => {
  const runtime = new ManagedProcessRuntime();
  const started = runtime.start(
    {
      executable: process.execPath,
      args: ['-e', 'console.log("done")'],
      env: {},
    },
    process.cwd(),
    'stop-with-aevra',
  );

  const status = await runtime.wait(started.processId, 5000);
  assert.equal(status.state, 'completed');
  assert.equal(status.exitCode, 0);
  assert.equal(status.signal, null);
  assert.ok(status.finishedAt);
  assert.ok((status.durationMs ?? -1) >= 0);

  const logs = runtime.logs(started.processId);
  assert.equal(logs.state, 'completed');
  assert.equal(logs.exitCode, 0);
  assert.equal(logs.eof, true);
  assert.ok(logs.lines.includes('done'));
});

test('managed process reports non-zero exit as failed', async () => {
  const runtime = new ManagedProcessRuntime();
  const started = runtime.start(
    {
      executable: process.execPath,
      args: ['-e', 'process.exit(7)'],
      env: {},
    },
    process.cwd(),
    'stop-with-aevra',
  );

  const status = await runtime.wait(started.processId, 5000);
  assert.equal(status.state, 'failed');
  assert.equal(status.exitCode, 7);
  assert.ok(status.finishedAt);
});

test('re-adoption requires pid start identity and exact marker', () => {
  const r = { helperPid: 2, helperStartedAt: 't', marker: 'secret-marker' };
  assert.equal(
    verifyReAdoption(r, { pid: 2, startedAt: 't', commandLine: 'node helper secret-marker' }),
    true,
  );
  assert.equal(
    verifyReAdoption(r, { pid: 2, startedAt: 'wrong', commandLine: 'node helper secret-marker' }),
    false,
  );
});

test('a spawn that never starts is reported as failed, not left running', async () => {
  const runtime = new ManagedProcessRuntime();
  const started = runtime.start(
    { executable: 'aevra-no-such-executable', args: [], env: {} },
    process.cwd(),
    'stop-with-aevra',
  );

  const status = await runtime.wait(started.processId, 5000);
  // Before this, 'error' had no listener, 'exit' never fired, and the entry sat
  // at 'running' with pid 0 forever - a process that was never created reading
  // back as a healthy one.
  assert.equal(status.state, 'failed');
  assert.ok(status.finishedAt);

  const logs = runtime.logs(started.processId);
  assert.equal(logs.eof, true);
  assert.ok(
    logs.lines.some((line) => line.includes('aevra-no-such-executable')),
    'the spawn failure should explain itself in the log',
  );
});

test('a bare command name resolves through PATHEXT on Windows', () => {
  // npm, npx and pnpm ship as .cmd shims; spawn with shell:false does no
  // extension lookup, which is what made every `npm run ...` managed process
  // fail with ENOENT on Windows.
  const resolved = resolveExecutable('npm', {
    PATH: path.dirname(process.execPath),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
  } as NodeJS.ProcessEnv);
  if (process.platform === 'win32') {
    assert.match(resolved, /npm\.(cmd|bat|exe)$/i);
  } else {
    assert.equal(resolved, 'npm', 'resolution is a Windows-only concern');
  }
});

test('an absolute executable and one carrying a separator are never rewritten', () => {
  assert.equal(resolveExecutable(process.execPath), process.execPath);
  assert.equal(resolveExecutable('./local/tool'), './local/tool');
});

test('a Windows shim is invoked through cmd.exe with every argument quoted', () => {
  // Node refuses to spawn a .cmd without a shell (CVE-2024-27980), so the shim
  // needs an explicit interpreter. What it must NOT get is shell: true, which
  // would re-parse model-supplied argv.
  const shim = windowsShimCommand('C:\\tools\\npm.cmd', ['run', 'build']);
  if (process.platform !== 'win32') {
    assert.equal(shim, null, 'only Windows needs the wrapper');
    return;
  }
  assert.ok(shim);
  assert.match(shim.executable.toLowerCase(), /cmd\.exe$/);
  assert.deepEqual(shim.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(shim.args[3], '""C:\\tools\\npm.cmd" "run" "build""');
});

test('an argument that cmd.exe would reinterpret is refused, not quoted around', () => {
  if (process.platform !== 'win32') return;
  for (const hostile of ['a"b', '%PATH%', 'a\r\nb']) {
    assert.throws(
      () => windowsShimCommand('C:\\tools\\npm.cmd', [hostile]),
      /cannot be passed safely/,
      hostile + ' should be refused',
    );
  }
});

test('a plain executable needs no shim wrapper', () => {
  assert.equal(windowsShimCommand(process.execPath, ['-e', '0']), null);
});
