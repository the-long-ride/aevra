import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAevraArgs } from '../src/args.js';

test('mcp list takes no arguments', () => {
  assert.deepEqual(parseAevraArgs(['mcp', 'list']), { command: 'mcp', action: 'list' });
  assert.throws(() => parseAevraArgs(['mcp', 'list', 'extra']), /takes no arguments/);
});
test('mcp add parses an http server with a reference', () => {
  assert.deepEqual(
    parseAevraArgs([
      'mcp',
      'add',
      'github',
      '--transport',
      'http',
      '--url',
      'https://mcp.example.com/mcp',
      '--header',
      'Authorization',
      '--secret-ref',
      'sr_github',
      '--risk',
      'HIGH',
    ]),
    {
      command: 'mcp',
      action: 'add',
      name: 'github',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      header: 'Authorization',
      secretRef: 'sr_github',
      risk: 'HIGH',
      args: [],
      env: {},
    },
  );
});
test('mcp add parses stdio args and env references', () => {
  assert.deepEqual(
    parseAevraArgs([
      'mcp',
      'add',
      'local-fs',
      '--transport',
      'stdio',
      '--command',
      'node',
      '--arg',
      'server.js',
      '--arg',
      '--root=/srv',
      '--env',
      'GITHUB_TOKEN=sr_gh',
    ]),
    {
      command: 'mcp',
      action: 'add',
      name: 'local-fs',
      transport: 'stdio',
      executable: 'node',
      args: ['server.js', '--root=/srv'],
      env: { GITHUB_TOKEN: 'sr_gh' },
      risk: 'MEDIUM',
    },
  );
});
test('credential values are refused', () => {
  assert.throws(
    () =>
      parseAevraArgs([
        'mcp',
        'add',
        'github',
        '--transport',
        'http',
        '--url',
        'https://x.test/mcp',
        '--secret-ref',
        'ghp_live_token',
      ]),
    /secret reference id/i,
  );
  assert.throws(
    () =>
      parseAevraArgs([
        'mcp',
        'add',
        'local',
        '--transport',
        'stdio',
        '--command',
        'node',
        '--env',
        'TOKEN=ghp_live_token',
      ]),
    /secret reference id/i,
  );
});
test('mcp add validates name transport risk and required config', () => {
  assert.throws(
    () =>
      parseAevraArgs(['mcp', 'add', 'My Server', '--transport', 'http', '--url', 'https://x.test']),
    /lowercase/i,
  );
  assert.throws(
    () => parseAevraArgs(['mcp', 'add', 'x', '--transport', 'carrier-pigeon']),
    /stdio\|http\|sse/,
  );
  assert.throws(
    () =>
      parseAevraArgs([
        'mcp',
        'add',
        'x',
        '--transport',
        'http',
        '--url',
        'https://x.test',
        '--risk',
        'FINE',
      ]),
    /LOW\|MEDIUM\|HIGH\|CRITICAL/,
  );
  assert.throws(() => parseAevraArgs(['mcp', 'add', 'x', '--transport', 'http']), /--url/);
  assert.throws(() => parseAevraArgs(['mcp', 'add', 'x', '--transport', 'stdio']), /--command/);
});
test('mcp remove and test take one id', () => {
  assert.deepEqual(parseAevraArgs(['mcp', 'remove', 'u1']), {
    command: 'mcp',
    action: 'remove',
    id: 'u1',
  });
  assert.deepEqual(parseAevraArgs(['mcp', 'test', 'u1']), {
    command: 'mcp',
    action: 'test',
    id: 'u1',
  });
  assert.throws(() => parseAevraArgs(['mcp', 'remove']), /requires an id/);
});
test('unknown mcp actions report usage', () => {
  assert.throws(() => parseAevraArgs(['mcp', 'frobnicate']), /mcp requires list\|add/);
});
