import assert from 'node:assert/strict';
import test from 'node:test';
import { runAgentCommand } from '../src/commands/agent-command.js';
import { detected, harness, okResponse, parse, posts } from './agent-command-fixture.js';

test('install with no targets lists detected agents, asks, and installs only those', async () => {
  const { deps, calls, logs, questions } = harness();
  assert.equal(await runAgentCommand(parse('install'), deps), 0);
  assert.deepEqual(questions, ['Proceed? [y/N]']);
  assert.deepEqual(posts(calls), [
    {
      operation: 'install',
      targets: ['codex', 'opencode'],
      scope: 'user',
      transport: 'stdio',
      dryRun: false,
    },
  ]);
  assert.match(
    logs.join('\n'),
    /Detected agents:\n {2}codex {5}on PATH\n {2}opencode {2}config at \/o/,
  );
  assert.match(logs.join('\n'), /Restart or refresh the agent to apply\.$/);
});

test('declining the prompt returns 1 without posting', async () => {
  const { deps, calls, logs } = harness({ answer: false });
  assert.equal(await runAgentCommand(parse('install'), deps), 1);
  assert.equal(posts(calls).length, 0);
  assert.match(logs.join('\n'), /Cancelled\. Nothing was changed\./);
});

test('--yes skips the prompt', async () => {
  const { deps, calls, questions } = harness({ interactive: false });
  assert.equal(await runAgentCommand(parse('install', '--yes'), deps), 0);
  assert.equal(questions.length, 0);
  assert.equal(posts(calls).length, 1);
});

test('a non-interactive run without --yes prints the list and returns 1', async () => {
  const { deps, calls, logs, errors, questions } = harness({ interactive: false });
  assert.equal(await runAgentCommand(parse('install'), deps), 1);
  assert.equal(questions.length, 0);
  assert.equal(posts(calls).length, 0);
  assert.match(logs.join('\n'), /Detected agents:/);
  assert.match(errors.join('\n'), /pass --yes/);
});

test('nothing detected returns 1 for no targets and for all, with no post', async () => {
  const none = detected.map((row) => ({ ...row, found: false, evidence: 'none' }));
  for (const args of [['install'], ['install', 'all'], ['install', '--yes']]) {
    const { deps, calls, errors } = harness({ detect: none });
    assert.equal(await runAgentCommand(parse(...args), deps), 1);
    assert.equal(posts(calls).length, 0);
    assert.match(errors.join('\n'), /No supported agents detected/);
  }
});

test('all expands to the detected agents without asking', async () => {
  const { deps, calls, questions } = harness();
  assert.equal(await runAgentCommand(parse('install', 'all'), deps), 0);
  assert.equal(questions.length, 0);
  assert.deepEqual(posts(calls)[0].targets, ['codex', 'opencode']);
});

test('a named target is forced even when not detected, and detection is skipped', async () => {
  const { deps, calls, questions } = harness();
  assert.equal(await runAgentCommand(parse('install', 'claude'), deps), 0);
  assert.equal(questions.length, 0);
  assert.deepEqual(posts(calls)[0].targets, ['claude-code']);
  assert.ok(!calls.some((call) => call.path === '/api/agents/detect'));
});

test('dry run does not ask and sends dryRun', async () => {
  const { deps, calls, questions, logs } = harness({ interactive: false });
  assert.equal(await runAgentCommand(parse('install', '--dry-run'), deps), 0);
  assert.equal(questions.length, 0);
  assert.equal(posts(calls)[0].dryRun, true);
  assert.match(logs.join('\n'), /dry run[\s\S]*Dry run: nothing was written\.$/);
});

test('--workspace resolves a name or an id to workspaceId in the body', async () => {
  for (const name of ['Demo', 'demo', 'ws-1']) {
    const { deps, calls } = harness();
    assert.equal(await runAgentCommand(parse('install', 'codex', '--workspace', name), deps), 0);
    assert.deepEqual(posts(calls), [
      {
        operation: 'install',
        targets: ['codex'],
        scope: 'workspace',
        workspaceId: 'ws-1',
        transport: 'stdio',
        dryRun: false,
      },
    ]);
  }
});

test('an unknown or ambiguous workspace errors before any post', async () => {
  const unknown = harness();
  assert.equal(
    await runAgentCommand(parse('install', 'codex', '--workspace', 'Nope'), unknown.deps),
    1,
  );
  assert.match(unknown.errors.join('\n'), /Unknown workspace: Nope.*Demo/);
  assert.equal(posts(unknown.calls).length, 0);
  const twice = harness({
    workspaces: [
      { id: 'a', name: 'Same' },
      { id: 'b', name: 'same' },
    ],
  });
  assert.equal(
    await runAgentCommand(parse('install', 'codex', '--workspace', 'same'), twice.deps),
    1,
  );
  assert.match(twice.errors.join('\n'), /Several workspaces are named/);
});

test('partial failure prints both outcomes and returns 1', async () => {
  const { deps, logs } = harness({
    post: (body) => ({
      body: {
        ...okResponse(body),
        results: [
          { target: 'codex', ok: true },
          { target: 'opencode', ok: false, error: 'AGENT_CONFIG_CONFLICT: edited by hand' },
        ],
      },
    }),
  });
  assert.equal(await runAgentCommand(parse('install', 'codex', 'opencode'), deps), 1);
  const text = logs.join('\n');
  assert.match(text, /ok {5}codex/);
  assert.match(text, /error {2}opencode {2}AGENT_CONFIG_CONFLICT: edited by hand/);
});

test('--json prints the response and strips credential fields', async () => {
  const response = {
    registrations: [
      { target: 'codex', credentialFile: 'f', credentialHash: 'h', credentialId: 'i' },
    ],
    results: [{ target: 'codex', ok: true }],
    changes: [],
    notes: [],
  };
  const { deps, logs } = harness({ post: () => ({ body: response }) });
  assert.equal(await runAgentCommand(parse('install', 'codex', '--json'), deps), 0);
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0]!), {
    ...response,
    registrations: [{ target: 'codex', credentialId: 'i' }],
  });
});

test('an API refusal is reported with its code and returns 1', async () => {
  const { deps, errors } = harness({
    post: () => ({
      status: 400,
      body: { error: { code: 'AGENT_WORKSPACE_UNAVAILABLE', message: 'no local folder' } },
    }),
  });
  assert.equal(await runAgentCommand(parse('install', 'codex'), deps), 1);
  assert.deepEqual(errors, ['[aevra] agent failed: AGENT_WORKSPACE_UNAVAILABLE: no local folder']);
});

test('a refused connection hints that core must be running', async () => {
  const { deps, errors } = harness();
  deps.api = async () => {
    throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  };
  assert.equal(await runAgentCommand(parse('list'), deps), 1);
  assert.match(
    errors[0]!,
    /^\[aevra\] agent failed: connect ECONNREFUSED\. Is aevra start\/service running\?$/,
  );
});

test('uninstall all without scope sends the single all target; with scope it lists them', async () => {
  const plain = harness();
  assert.equal(await runAgentCommand(parse('uninstall', 'all'), plain.deps), 0);
  assert.deepEqual(posts(plain.calls), [
    { operation: 'uninstall', target: 'all', scope: 'all', transport: 'stdio', dryRun: false },
  ]);
  const scoped = harness();
  assert.equal(await runAgentCommand(parse('uninstall', 'all', '--scope', 'user'), scoped.deps), 0);
  assert.deepEqual(posts(scoped.calls), [
    { operation: 'uninstall', targets: ['all'], scope: 'user', transport: 'stdio', dryRun: false },
  ]);
  const named = harness();
  assert.equal(
    await runAgentCommand(parse('uninstall', 'codex', '--workspace', 'Demo'), named.deps),
    0,
  );
  assert.deepEqual(posts(named.calls), [
    {
      operation: 'uninstall',
      targets: ['codex'],
      scope: 'workspace',
      workspaceId: 'ws-1',
      transport: 'stdio',
      dryRun: false,
    },
  ]);
});

test('with --json stdout is one JSON document for bare install, all and a decline', async () => {
  for (const args of [
    ['install', '--yes', '--json'],
    ['install', 'all', '--json'],
  ]) {
    const { deps, logs, errors } = harness();
    assert.equal(await runAgentCommand(parse(...args), deps), 0);
    assert.equal(logs.length, 1);
    const body = JSON.parse(logs[0]!);
    assert.deepEqual(
      body.results.map((row: { target: string }) => row.target),
      ['codex', 'opencode'],
    );
    assert.match(errors.join('\n'), /Detected agents:/);
  }
  const declined = harness({ answer: false });
  assert.equal(await runAgentCommand(parse('install', '--json'), declined.deps), 1);
  assert.deepEqual(declined.logs, []);
  assert.match(declined.errors.join('\n'), /Cancelled\. Nothing was changed\./);
});

test('a response without results prints its message, or a version hint and fails', async () => {
  const said = harness({
    post: () => ({ body: { message: 'install complete', registrations: [] } }),
  });
  assert.equal(await runAgentCommand(parse('install', 'codex'), said.deps), 0);
  assert.deepEqual(said.logs, ['install complete']);
  assert.deepEqual(said.errors, []);
  const bare = harness({ post: () => ({ body: { registrations: [] } }) });
  assert.equal(await runAgentCommand(parse('uninstall', 'all'), bare.deps), 1);
  assert.deepEqual(bare.logs, []);
  assert.match(
    bare.errors.join('\n'),
    /^\[aevra\] .*older than this CLI.*GET \/api\/health.*aevra start/,
  );
  const json = harness({ post: () => ({ body: { registrations: [] } }) });
  assert.equal(await runAgentCommand(parse('uninstall', 'all', '--json'), json.deps), 1);
  assert.equal(json.logs.length, 1);
});
