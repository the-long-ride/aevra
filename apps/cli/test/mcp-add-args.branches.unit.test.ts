import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAevraArgs } from '../src/args.js';

const add = (...rest: string[]) => parseAevraArgs(['mcp', 'add', ...rest]);

test('mcp add builds a stdio server with args, env references and risk', () => {
  assert.deepEqual(
    add(
      'files',
      '--transport',
      'stdio',
      '--command',
      'node',
      '--arg',
      '--inspect',
      '--arg',
      'server.js',
      '--env',
      'TOKEN_NAME=sr_files.ref',
      '--risk',
      'HIGH',
    ),
    {
      command: 'mcp',
      action: 'add',
      name: 'files',
      transport: 'stdio',
      executable: 'node',
      args: ['--inspect', 'server.js'],
      env: { TOKEN_NAME: 'sr_files.ref' },
      risk: 'HIGH',
    },
  );
});

test('mcp add builds an http server with optional header and secret reference', () => {
  assert.deepEqual(
    add(
      'remote-1',
      '--transport',
      'http',
      '--url',
      'https://mcp.example.com',
      '--header',
      'X-Api-Key',
      '--secret-ref',
      'sr_remote',
    ),
    {
      command: 'mcp',
      action: 'add',
      name: 'remote-1',
      transport: 'http',
      url: 'https://mcp.example.com',
      header: 'X-Api-Key',
      secretRef: 'sr_remote',
      args: [],
      env: {},
      risk: 'MEDIUM',
    },
  );
  assert.deepEqual(add('events', '--transport', 'sse', '--url', 'https://sse.example.com'), {
    command: 'mcp',
    action: 'add',
    name: 'events',
    transport: 'sse',
    url: 'https://sse.example.com',
    args: [],
    env: {},
    risk: 'MEDIUM',
  });
});

test('mcp add validates its name', () => {
  assert.throws(() => add(), /mcp add requires a name/);
  assert.throws(() => add('--transport', 'stdio'), /mcp add requires a name/);
  assert.throws(() => add('Bad_Name'), /lowercase name/);
});

test('mcp add validates option values', () => {
  assert.throws(() => add('s', '--transport'), /--transport requires a value/);
  assert.throws(() => add('s', '--url', '--transport'), /--url requires a value/);
  assert.throws(() => add('s', '--transport', 'ws'), /--transport requires stdio\|http\|sse/);
  assert.throws(() => add('s', '--risk', 'LOWEST'), /--risk requires LOW/);
  assert.throws(() => add('s', '--env', 'NOEQUALS'), /--env requires NAME=sr_reference/);
  assert.throws(() => add('s', '--env', '=sr_x'), /--env requires NAME=sr_reference/);
  assert.throws(() => add('s', '--env', 'NAME=plain words'), /secret reference id/);
  assert.throws(() => add('s', '--secret-ref', 'plain words'), /secret reference id/);
  assert.throws(() => add('s', '--color', 'blue'), /Unknown mcp add option: --color/);
});

test('mcp add requires transport-specific fields', () => {
  assert.throws(() => add('s'), /requires --transport/);
  assert.throws(() => add('s', '--transport', 'stdio'), /stdio server requires --command/);
  assert.throws(() => add('s', '--transport', 'http'), /requires --url/);
});
