import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAevraArgs } from '../src/args.js';

test('empty argv shows help', () => {
  assert.deepEqual(parseAevraArgs([]), { command: 'help' });
});

test('setup takes no options', () => {
  assert.deepEqual(parseAevraArgs(['setup']), { command: 'setup' });
  assert.throws(() => parseAevraArgs(['setup', '--fast']), /Unknown option: --fast/);
});

test('ui defaults logoutAll to false and rejects unknown flags', () => {
  assert.deepEqual(parseAevraArgs(['ui']), { command: 'ui', logoutAll: false });
  assert.throws(() => parseAevraArgs(['ui', '--wide']), /Unknown option: --wide/);
});

test('service accepts exactly one known action', () => {
  for (const action of ['install', 'start', 'stop', 'restart', 'status']) {
    assert.deepEqual(parseAevraArgs(['service', action]), { command: 'service', action });
  }
  assert.throws(() => parseAevraArgs(['service']), /service requires/);
  assert.throws(() => parseAevraArgs(['service', 'reload']), /service requires/);
  assert.throws(() => parseAevraArgs(['service', 'start', 'now']), /service requires/);
});

test('completion requires exactly one shell', () => {
  assert.deepEqual(parseAevraArgs(['completion', 'zsh']), { command: 'completion', shell: 'zsh' });
  assert.throws(() => parseAevraArgs(['completion']), /completion requires/);
  assert.throws(() => parseAevraArgs(['completion', 'bash', 'zsh']), /completion requires/);
});

test('backup parses verify and restore with an optional --yes', () => {
  assert.deepEqual(parseAevraArgs(['backup', 'verify', 'a.bak']), {
    command: 'backup',
    action: 'verify',
    file: 'a.bak',
    yes: false,
  });
  assert.deepEqual(parseAevraArgs(['backup', 'restore', 'a.bak', '--yes']), {
    command: 'backup',
    action: 'restore',
    file: 'a.bak',
    yes: true,
  });
});

test('backup rejects missing actions, files and extra options', () => {
  assert.throws(() => parseAevraArgs(['backup']), /backup requires verify\|restore/);
  assert.throws(() => parseAevraArgs(['backup', 'export', 'a.bak']), /backup requires verify/);
  assert.throws(() => parseAevraArgs(['backup', 'verify']), /requires a file path/);
  assert.throws(() => parseAevraArgs(['backup', 'verify', '']), /requires a file path/);
  assert.throws(() => parseAevraArgs(['backup', 'verify', 'a.bak', '--no']), /Unknown backup/);
  assert.throws(
    () => parseAevraArgs(['backup', 'verify', 'a.bak', '--yes', 'more']),
    /Unknown backup option/,
  );
});

test('audit clear parses --yes and rejects anything else', () => {
  assert.deepEqual(parseAevraArgs(['audit', 'clear']), {
    command: 'audit',
    action: 'clear',
    yes: false,
  });
  assert.deepEqual(parseAevraArgs(['audit', 'clear', '--yes']), {
    command: 'audit',
    action: 'clear',
    yes: true,
  });
  assert.throws(() => parseAevraArgs(['audit']), /audit requires clear/);
  assert.throws(() => parseAevraArgs(['audit', 'clear', '--all']), /Unknown audit option/);
  assert.throws(() => parseAevraArgs(['audit', 'clear', '--yes', 'x']), /Unknown audit option/);
});

test('extension install parses --dir and --yes in any order', () => {
  assert.deepEqual(parseAevraArgs(['extension', 'install']), {
    command: 'extension',
    action: 'install',
    yes: false,
  });
  assert.deepEqual(parseAevraArgs(['extension', 'install', '--yes', '--dir', 'out']), {
    command: 'extension',
    action: 'install',
    dir: 'out',
    yes: true,
  });
  assert.throws(() => parseAevraArgs(['extension']), /extension requires install/);
  assert.throws(() => parseAevraArgs(['extension', 'install', '--dir']), /--dir requires a path/);
  assert.throws(
    () => parseAevraArgs(['extension', 'install', '--dir', '--yes']),
    /--dir requires a path/,
  );
  assert.throws(
    () => parseAevraArgs(['extension', 'install', '--force']),
    /Unknown extension option: --force/,
  );
});

test('sessions subcommands parse and validate their arguments', () => {
  assert.deepEqual(parseAevraArgs(['sessions', 'list']), { command: 'sessions', action: 'list' });
  assert.deepEqual(parseAevraArgs(['sessions', 'revoke', 'ses_1']), {
    command: 'sessions',
    action: 'revoke',
    id: 'ses_1',
  });
  assert.deepEqual(parseAevraArgs(['sessions', 'revoke-others']), {
    command: 'sessions',
    action: 'revoke-others',
    yes: false,
  });
  assert.deepEqual(parseAevraArgs(['sessions', 'revoke-others', '--yes']), {
    command: 'sessions',
    action: 'revoke-others',
    yes: true,
  });
  assert.throws(() => parseAevraArgs(['sessions', 'list', 'x']), /takes no arguments/);
  assert.throws(() => parseAevraArgs(['sessions', 'revoke']), /requires an id/);
  assert.throws(() => parseAevraArgs(['sessions', 'revoke', '']), /requires an id/);
  assert.throws(() => parseAevraArgs(['sessions', 'revoke-others', '-y']), /Unknown sessions/);
  assert.throws(
    () => parseAevraArgs(['sessions', 'revoke-others', '--yes', 'x']),
    /Unknown sessions option/,
  );
  assert.throws(() => parseAevraArgs(['sessions']), /sessions requires list/);
});

test('connections subcommands parse and validate their arguments', () => {
  assert.deepEqual(parseAevraArgs(['connections', 'list']), {
    command: 'connections',
    action: 'list',
  });
  assert.deepEqual(parseAevraArgs(['connections', 'revoke', 'c1']), {
    command: 'connections',
    action: 'revoke',
    id: 'c1',
  });
  assert.throws(() => parseAevraArgs(['connections', 'list', 'x']), /takes no arguments/);
  assert.throws(() => parseAevraArgs(['connections', 'revoke']), /requires an id/);
  assert.throws(() => parseAevraArgs(['connections', 'revoke', '']), /requires an id/);
  assert.throws(() => parseAevraArgs(['connections', 'drop']), /connections requires/);
});

test('connectors rejects extra or empty arguments', () => {
  assert.throws(() => parseAevraArgs(['connectors', 'list', 'x']), /takes no arguments/);
  assert.throws(() => parseAevraArgs(['connectors', 'create', '']), /requires a name/);
  assert.throws(() => parseAevraArgs(['connectors', 'revoke']), /requires an id/);
  assert.throws(() => parseAevraArgs(['connectors', 'revoke', 'a', 'b']), /requires an id/);
});

test('mcp list, remove and test parse; bad forms are rejected', () => {
  assert.deepEqual(parseAevraArgs(['mcp', 'list']), { command: 'mcp', action: 'list' });
  assert.deepEqual(parseAevraArgs(['mcp', 'remove', 'u1']), {
    command: 'mcp',
    action: 'remove',
    id: 'u1',
  });
  assert.deepEqual(parseAevraArgs(['mcp', 'test', 'u1']), { command: 'mcp', action: 'test', id: 'u1' });
  assert.throws(() => parseAevraArgs(['mcp', 'list', 'x']), /mcp list takes no arguments/);
  assert.throws(() => parseAevraArgs(['mcp', 'remove']), /mcp remove requires an id/);
  assert.throws(() => parseAevraArgs(['mcp', 'test', '']), /mcp test requires an id/);
  assert.throws(() => parseAevraArgs(['mcp']), /mcp requires list/);
});

test('unknown commands are rejected', () => {
  assert.throws(() => parseAevraArgs(['launch']), /Unknown command: launch/);
});
