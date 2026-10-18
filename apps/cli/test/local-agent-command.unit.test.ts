import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentUsageError,
  runLocalAgentCommand,
  type LocalAgentDependencies,
} from '../src/local-agent-command.js';

function fakes(code = 0) {
  const bridged: string[] = [];
  const deps: LocalAgentDependencies = {
    async bridge(file) {
      bridged.push(file);
      return code;
    },
  };
  return { deps, bridged };
}

test('agent serve starts the stdio bridge with the credential file', async () => {
  const { deps, bridged } = fakes(3);
  const result = await runLocalAgentCommand(
    ['agent', 'serve', '--credential-file', 'managed.json'],
    deps,
  );
  assert.equal(result, 3);
  assert.deepEqual(bridged, ['managed.json']);
});

test('malformed serve invocations are usage errors, not bridge starts', async () => {
  for (const argv of [
    ['agent', 'serve'],
    ['agent', 'serve', '--credential-file'],
    ['agent', 'serve', '--stdio', '--credential-file', 'x'],
    ['agent', 'serve', '--credential-file', 'x', 'extra'],
  ]) {
    const { deps, bridged } = fakes();
    await assert.rejects(runLocalAgentCommand(argv, deps), (error: unknown) => {
      assert.ok(error instanceof AgentUsageError);
      assert.match((error as Error).message, /Usage: aevra agent serve --credential-file/);
      return true;
    });
    assert.equal(bridged.length, 0);
  }
});

test('everything else falls through to normal parsing, including the removed mcp serve', async () => {
  for (const argv of [
    [],
    ['status'],
    ['agent', 'list'],
    ['agent'],
    ['mcp', 'list'],
    ['mcp', 'serve', '--stdio', '--credential-file', 'x'],
    ['mcp', 'serve'],
    ['uninstall'],
  ]) {
    const { deps, bridged } = fakes();
    assert.equal(await runLocalAgentCommand(argv, deps), null);
    assert.equal(bridged.length, 0);
  }
});
