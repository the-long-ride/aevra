import assert from 'node:assert/strict';
import test from 'node:test';
import { propagateCwdFlow } from '../src/cwd-flow.js';
import type { CommandNode } from '../src/types.js';

function node(id: string, overrides: Partial<CommandNode> = {}): CommandNode {
  return {
    id,
    dialect: 'bash',
    argv: ['echo'],
    wrappers: [],
    application: 'echo',
    operation: ['echo'],
    options: [],
    forwardedArgv: [],
    cwdCandidates: [],
    modifiers: [],
    targets: [],
    effect: 'READ_ONLY',
    risk: 'LOW',
    scope: 'inside',
    reasons: [],
    ...overrides,
  };
}

test('propagateCwdFlow: drive-letter and relative roots, pushd/popd, pipe and subshell', () => {
  const drive = [node('c1', { application: 'builtin:cd', operation: ['cd', 'sub'] }), node('e1')];
  propagateCwdFlow('C:\\work', drive, []);
  assert.deepEqual(drive[0]!.cwdCandidates, ['C:/work/sub']);
  assert.deepEqual(drive[1]!.cwdCandidates, ['C:/work/sub']);

  const rel = [node('r1')];
  propagateCwdFlow('repo', rel, []);
  assert.deepEqual(rel[0]!.cwdCandidates, ['/repo']);

  const stack = [
    node('p1', { application: 'builtin:pushd', operation: ['pushd', 'a'] }),
    node('p2'),
    node('p3', { application: 'builtin:popd', operation: ['popd'] }),
    node('p4', { application: 'builtin:popd', operation: ['popd'] }),
  ];
  propagateCwdFlow('/', stack, []);
  assert.deepEqual(stack[1]!.cwdCandidates, ['/a']);
  assert.deepEqual(stack[2]!.cwdCandidates, ['/']);
  assert.deepEqual(stack[3]!.cwdCandidates, ['/']);

  for (const kind of ['pipe', 'subshell'] as const) {
    const piped = [
      node('x1', { application: 'builtin:cd', operation: ['cd', 'inner'] }),
      node('x2'),
    ];
    propagateCwdFlow('/', piped, [{ from: 'x1', to: 'x2', kind }]);
    assert.deepEqual(piped[1]!.cwdCandidates, ['/'], kind);
  }
});
