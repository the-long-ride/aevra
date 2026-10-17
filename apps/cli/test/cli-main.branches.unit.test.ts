import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { main } from '../src/cli.js';

const plainPhrase1 = 'sample words';

const ENV_KEYS = [
  'AEVRA_STATE_DIR',
  'AEVRA_USERNAME',
  'AEVRA_PASSWORD',
  'AEVRA_TLS_CERT',
  'AEVRA_TLS_KEY',
  'AEVRA_ADMIN_PORT',
];

// Runs main() in-process against an empty state directory with the admin port
// pointed at loopback port 1, where nothing listens, so every admin command
// fails with a refused local connection and never reaches a running daemon.
async function runMain(argv: string[], env: Record<string, string> = {}) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-cli-main-'));
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.AEVRA_STATE_DIR = stateDir;
  process.env.AEVRA_USERNAME = 'sample';
  process.env.AEVRA_PASSWORD = plainPhrase1;
  process.env.AEVRA_ADMIN_PORT = '1';
  Object.assign(process.env, env);
  console.log = (...parts: unknown[]) => void logs.push(parts.join(' '));
  console.error = (...parts: unknown[]) => void errors.push(parts.join(' '));
  try {
    const code = await main(argv);
    return { code, logs, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(stateDir, { recursive: true, force: true });
  }
}

test('main reports parse errors with usage text', async () => {
  const result = await runMain(['no-such-command']);
  assert.equal(result.code, 1);
  assert.match(result.errors[0]!, /^\[aevra\] .+\n\nAevra/);
});

test('main reports configuration errors before dispatching', async () => {
  const result = await runMain(['status'], { AEVRA_TLS_CERT: 'cert.pem' });
  assert.equal(result.code, 1);
  assert.deepEqual(result.errors, [
    '[aevra] AEVRA_TLS_CERT and AEVRA_TLS_KEY must be set together',
  ]);
});

const adminCommands: string[][] = [
  ['mcp', 'list'],
  ['connectors', 'list'],
  ['connections', 'list'],
  ['sessions', 'list'],
  ['audit', 'clear', '--yes'],
  ['status'],
  ['agent', 'list'],
  ['agent', 'install', 'codex', '--dry-run'],
  ['uninstall', '--dry-run'],
];

for (const argv of adminCommands) {
  test(`main routes ${argv.join(' ')} through the admin session and reports the refused connection`, async () => {
    const result = await runMain(argv);
    assert.equal(result.code, 1);
    assert.equal(result.logs.length, 0);
    assert.ok(result.errors.length > 0);
    assert.match(result.errors.join('\n'), /failed: .*Is aevra start\/service running\?$/);
  });
}

test('agent usage errors print the agent help and no core-start suffix', async () => {
  for (const argv of [
    ['agent', 'install', '--scope', 'workspace'],
    ['agent', 'install', '--wat'],
    ['agent', 'serve'],
  ]) {
    const result = await runMain(argv);
    assert.equal(result.code, 1);
    assert.equal(result.logs.length, 0);
    const text = result.errors.join('\n');
    assert.match(text, /^\[aevra\] /);
    assert.doesNotMatch(text, /Start core|aevra start if unavailable/);
  }
  const parse = await runMain(['agent', 'install', '--wat']);
  assert.match(parse.errors[0]!, /Unknown option: --wat\n\nUsage: aevra agent <command>/);
});

test('agent --help prints the agent help without loading configuration', async () => {
  const result = await runMain(['agent', '--help'], { AEVRA_TLS_CERT: 'cert.pem' });
  assert.equal(result.code, 0);
  assert.equal(result.errors.length, 0);
  assert.match(result.logs.join('\n'), /^Usage: aevra agent <command>/);
});

test('mcp serve is an unknown mcp action and never starts the bridge', async () => {
  for (const argv of [
    ['mcp', 'serve', '--stdio', '--credential-file', 'absent.json'],
    ['mcp', 'serve'],
  ]) {
    const result = await runMain(argv);
    assert.equal(result.code, 1);
    const text = result.errors.join('\n');
    assert.match(text, /^\[aevra\] mcp requires list\|add/);
    assert.doesNotMatch(text, /Start core|ENOENT|credential/);
  }
});

test('main routes backup verify through the sqlite inspector', async () => {
  const result = await runMain([
    'backup',
    'verify',
    path.join(os.tmpdir(), `aevra-absent-${process.pid}`, 'backup.db'),
  ]);
  assert.equal(result.code, 1);
  assert.match(result.errors.join('\n'), /^\[aevra\] backup failed: /);
});
