import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAevraArgs } from '../src/args.js';

test('help aliases parse', () => {
  for (const arg of ['help', '--help', '-h', '-help']) {
    assert.deepEqual(parseAevraArgs([arg]), { command: 'help' });
  }
});

test('start supports optional UI launch', () => {
  assert.deepEqual(parseAevraArgs(['start']), {
    command: 'start',
    ui: false,
  });
  assert.deepEqual(parseAevraArgs(['start', '--ui']), {
    command: 'start',
    ui: true,
  });
  assert.throws(() => parseAevraArgs(['start', '--wat']), /Unknown option/);
});

test('ui supports logout-all', () => {
  assert.deepEqual(parseAevraArgs(['ui', '--logout-all']), {
    command: 'ui',
    logoutAll: true,
  });
});

test('legacy flags rejected', () => {
  assert.throws(
    () => parseAevraArgs(['start', '--password', 'x']),
    /Unknown option/,
  );
});

test('connectors subcommands parse', () => {
  assert.deepEqual(parseAevraArgs(['connectors', 'list']), {
    command: 'connectors',
    action: 'list',
  });
  assert.deepEqual(parseAevraArgs(['connectors', 'create', 'Claude.ai']), {
    command: 'connectors',
    action: 'create',
    name: 'Claude.ai',
  });
  assert.deepEqual(parseAevraArgs(['connectors', 'revoke', 'con_x']), {
    command: 'connectors',
    action: 'revoke',
    id: 'con_x',
  });
  assert.throws(() => parseAevraArgs(['connectors']), /connectors requires/);
  assert.throws(
    () => parseAevraArgs(['connectors', 'create']),
    /requires a name/,
  );
});

test('status parses --json and rejects unknown flags', () => {
  assert.deepEqual(parseAevraArgs(['status']), {
    command: 'status',
    json: false,
  });
  assert.deepEqual(parseAevraArgs(['status', '--json']), {
    command: 'status',
    json: true,
  });
  assert.throws(
    () => parseAevraArgs(['status', '--verbose']),
    /Unknown option/,
  );
});

test('completion parses shells and rejects others', () => {
  assert.deepEqual(parseAevraArgs(['completion', 'bash']), {
    command: 'completion',
    shell: 'bash',
  });
  assert.deepEqual(parseAevraArgs(['completion', 'powershell']), {
    command: 'completion',
    shell: 'powershell',
  });
  assert.throws(
    () => parseAevraArgs(['completion', 'fish']),
    /completion requires/,
  );
});
