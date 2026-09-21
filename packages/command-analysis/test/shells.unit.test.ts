import assert from 'node:assert/strict';
import test from 'node:test';
import { parseShellScript } from '../src/shells/index.js';

test('Quoted separators are treated as arguments, not command splitters', () => {
  const bashResult = parseShellScript('echo "hello && world"', 'bash');
  assert.equal(bashResult.nodes.length, 1);
  assert.equal(bashResult.nodes[0]?.argv[1], 'hello && world');

  const pwshResult = parseShellScript('Write-Output "foo ; bar"', 'pwsh');
  assert.equal(pwshResult.nodes.length, 1);
  assert.equal(pwshResult.nodes[0]?.argv[1], 'foo ; bar');
});

test('PowerShell call operator handles quoted command executables', () => {
  const result = parseShellScript('& "git" status', 'pwsh');
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0]?.application, 'git');
  assert.deepEqual(result.nodes[0]?.operation, ['status']);
});

test('CMD caret escaping prevents command splitting', () => {
  const result = parseShellScript('echo hello ^& world', 'cmd');
  assert.equal(result.nodes.length, 1);
  assert.ok(result.nodes[0]?.argv.join(' ').includes('&'));
});

test('Command chains generate appropriate edge kinds', () => {
  // Conditional success &&
  const successChain = parseShellScript('npm test && git status', 'bash');
  assert.equal(successChain.nodes.length, 2);
  assert.equal(successChain.edges[0]?.kind, 'success');

  // Conditional failure ||
  const failChain = parseShellScript('npm test || git status', 'bash');
  assert.equal(failChain.nodes.length, 2);
  assert.equal(failChain.edges[0]?.kind, 'failure');

  // Pipeline |
  const pipeChain = parseShellScript('git status | grep modified', 'bash');
  assert.equal(pipeChain.nodes.length, 2);
  assert.equal(pipeChain.edges[0]?.kind, 'pipe');
});

test('Nested shell invocation preserves launcher and analyzes children recursively', () => {
  const nested = parseShellScript('bash -c "git status && git diff"', 'bash');
  assert.equal(nested.nodes.length, 3);
  assert.equal(nested.nodes[0]?.application, 'bash');
  assert.equal(nested.nodes[1]?.application, 'git');
  assert.deepEqual(nested.nodes[1]?.operation, ['status']);
  assert.equal(nested.nodes[2]?.application, 'git');
  assert.deepEqual(nested.nodes[2]?.operation, ['diff']);
  assert.equal(nested.edges[0]?.kind, 'subshell');
  assert.equal(nested.edges[1]?.kind, 'success');
});

test('Nested shell keeps outer redirects as authorization targets', () => {
  const nested = parseShellScript("bash -c 'echo hello' > /outside/review.txt", 'bash');
  assert.equal(nested.nodes[0]?.application, 'bash');
  assert.deepEqual(nested.nodes[0]?.targets, [
    { path: '/outside/review.txt', access: 'write', scope: 'unknown' },
  ]);
  assert.equal(nested.nodes[1]?.application, 'echo');
});

test('Bash background lists expose both commands to policy analysis', () => {
  const result = parseShellScript('git status & git push', 'bash');
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes[0]?.application, 'git');
  assert.deepEqual(result.nodes[0]?.operation, ['status']);
  assert.deepEqual(result.nodes[1]?.operation, ['push']);
});

test('Malformed Bash quoting fails closed', () => {
  const result = parseShellScript("echo 'unterminated", 'bash');
  assert.ok(result.reasons.some((reason) => reason.code === 'UNSUPPORTED_SYNTAX'));
});

test('Oversized scripts trigger ANALYSIS_LIMIT', () => {
  const hugeScript = 'a'.repeat(65 * 1024);
  const result = parseShellScript(hugeScript, 'bash');
  assert.ok(result.reasons.some((r) => r.code === 'ANALYSIS_LIMIT'));
});

test('Parse time budget fails closed with ANALYSIS_LIMIT', () => {
  const result = parseShellScript('echo ok', 'bash', 0, {
    startedAtMs: 0,
    now: () => 1501,
  });
  assert.equal(result.nodes.length, 0);
  assert.ok(result.reasons.some((r) => r.code === 'ANALYSIS_LIMIT'));
});
