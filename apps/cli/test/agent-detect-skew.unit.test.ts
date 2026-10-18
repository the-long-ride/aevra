import assert from 'node:assert/strict';
import test from 'node:test';
import { runAgentCommand } from '../src/commands/agent-command.js';
import { harness, parse, posts } from './agent-command-fixture.js';

test('a core without the detect route prints the version hint and exits 1', async () => {
  for (const args of [['list'], ['install'], ['install', 'all', '--yes'], ['list', '--json']]) {
    const h = harness();
    const api = h.deps.api;
    h.deps.api = async (path, init) =>
      path === '/api/agents/detect'
        ? { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND' } }) }
        : api(path, init);
    assert.equal(await runAgentCommand(parse(...args), h.deps), 1, args.join(' '));
    const text = h.errors.join('\n');
    assert.match(text, /^\[aevra\] .*older than this CLI/);
    assert.match(text, /GET \/api\/health and restart aevra start/);
    assert.deepEqual(h.logs, []);
    assert.equal(posts(h.calls).length, 0);
  }
});

test('other detect failures keep the plain error message', async () => {
  const h = harness();
  h.deps.api = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { code: 'AGENT_INTEGRATION_UNAVAILABLE' } }),
  });
  assert.equal(await runAgentCommand(parse('list'), h.deps), 1);
  assert.match(h.errors[0]!, /agent failed: AGENT_INTEGRATION_UNAVAILABLE/);
  assert.doesNotMatch(h.errors[0]!, /older than this CLI/);
});
