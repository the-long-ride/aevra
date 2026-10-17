import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import type { CoreConfig } from '../../core/src/config.js';
import type { AdminRequestInit, AdminSessionDependencies } from '../src/admin-session.js';
import { agentDependencies, coreShutdown, rootCleanup } from '../src/agent-wiring.js';

const config = { adminPort: 47831, stateDir: 'unused' } as unknown as CoreConfig;
const origin = 'https://localhost:47831';

// Stub admin session: no network. Every call after the login is recorded.
function admin(reply: (path: string) => { status: number; body: unknown } = () => reply200) {
  const seen: Array<{ path: string; init?: AdminRequestInit }> = [];
  const deps: AdminSessionDependencies<CoreConfig> = {
    async controlSecret() {
      return 'unused';
    },
    async credentials() {
      return { username: 'sample', password: 'plain words' };
    },
    base: () => origin,
    async fetch(_config, path, init) {
      if (path === '/api/auth/login')
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => (name === 'set-cookie' ? 'session=one; Path=/' : null) },
          json: async () => ({}),
        };
      seen.push({ path, init });
      const result = reply(path);
      return {
        ok: result.status < 300,
        status: result.status,
        headers: { get: () => null },
        json: async () => result.body,
      };
    },
  };
  return { deps, seen };
}
const reply200 = { status: 200, body: {} };

function streams() {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  return { input, output };
}

test('the origin header is added to POST only and GET passes through untouched', async () => {
  const { deps, seen } = admin();
  const { api } = agentDependencies(config, deps, streams());
  await api('/api/agents', { method: 'GET' });
  await api('/api/agents/detect');
  await api('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.deepEqual(seen[0]!.init?.headers, { cookie: 'session=one' });
  assert.deepEqual(seen[1]!.init?.headers, { cookie: 'session=one' });
  assert.deepEqual(seen[2]!.init?.headers, {
    'content-type': 'application/json',
    origin,
    cookie: 'session=one',
  });
  assert.equal(seen[2]!.init?.body, '{}');
});

test('workspaces keeps id and name as strings and refuses a failed response', async () => {
  const ok = admin(() => ({
    status: 200,
    body: [
      { id: 7, name: 'Demo', hostRoot: '/not/used' },
      { id: 'b', name: 'Other' },
    ],
  }));
  assert.deepEqual(await agentDependencies(config, ok.deps, streams()).workspaces(), [
    { id: '7', name: 'Demo' },
    { id: 'b', name: 'Other' },
  ]);
  assert.equal(ok.seen[0]!.path, '/api/workspaces');
  const failed = admin(() => ({ status: 500, body: {} }));
  await assert.rejects(
    agentDependencies(config, failed.deps, streams()).workspaces(),
    /Core returned 500/,
  );
});

const answers: Array<[string, boolean]> = [
  ['y', true],
  ['yes', true],
  ['YES', true],
  ['n', false],
  ['', false],
  ['yep', false],
];
for (const [typed, expected] of answers) {
  test(`confirm reads ${JSON.stringify(typed)} as ${expected}`, { timeout: 5000 }, async () => {
    const terminal = streams();
    const asked: string[] = [];
    terminal.output.on('data', (chunk) => asked.push(String(chunk)));
    const answer = agentDependencies(config, admin().deps, terminal).confirm('Proceed? [y/N]');
    terminal.input.write(`${typed}\n`);
    assert.equal(await answer, expected);
    assert.match(asked.join(''), /Proceed\? \[y\/N\] /);
  });
}

test(
  'confirm treats a closed input as a refusal instead of hanging',
  { timeout: 5000 },
  async () => {
    const terminal = streams();
    const answer = agentDependencies(config, admin().deps, terminal).confirm('Proceed? [y/N]');
    terminal.input.end();
    assert.equal(await answer, false);
  },
);

test('isInteractive needs a terminal on both ends', () => {
  const terminal = streams() as { input: PassThrough & { isTTY?: boolean }; output: PassThrough };
  const ask = () => agentDependencies(config, admin().deps, terminal).isInteractive();
  assert.equal(ask(), false);
  terminal.input.isTTY = true;
  assert.equal(ask(), false);
  (terminal.output as PassThrough & { isTTY?: boolean }).isTTY = true;
  assert.equal(ask(), true);
});

test('core shutdown posts with the origin header and fails on a refusal', async () => {
  const ok = admin();
  await coreShutdown(config, ok.deps)();
  assert.equal(ok.seen[0]!.path, '/api/agents/shutdown');
  assert.equal(ok.seen[0]!.init?.method, 'POST');
  assert.equal(ok.seen[0]!.init?.headers?.origin, origin);
  const refused = admin(() => ({ status: 503, body: {} }));
  await assert.rejects(coreShutdown(config, refused.deps)(), /Core returned 503/);
});

test('a dry-run root cleanup only reports and never calls core or the home folder', async () => {
  const { deps, seen } = admin();
  const result = await rootCleanup(config, deps)(true, true);
  assert.match(
    (result as { message: string }).message,
    /^Would remove root Aevra managed integrations, service and owned application state\./,
  );
  assert.equal(seen.length, 0);
});
