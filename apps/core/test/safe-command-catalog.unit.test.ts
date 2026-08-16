import assert from 'node:assert/strict';
import test from 'node:test';
import { SAFE_COMMAND_MATCHERS } from '../../web-react/src/features/guide/safe-command-matchers.js';
import { classifyCommand } from '../src/policy/command-family.js';

function glob(pattern: string, value: string) {
  const source =
    '^' +
    pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*') +
    '$';
  return new RegExp(source).test(value);
}
const samples: Record<string, string[]> = {
  'git:status': ['git', 'status'],
  'git:diff': ['git', 'diff'],
  'git:log': ['git', 'log', '-10'],
  'git:show': ['git', 'show', 'HEAD'],
  'git:fetch': ['git', 'fetch'],
  'git:pull': ['git', 'pull', '--ff-only'],
  'npm:test': ['npm', 'test'],
  'pnpm:test': ['pnpm', 'test'],
  'pnpm:lint': ['pnpm', 'lint'],
  'yarn:test': ['yarn', 'test'],
  'yarn:lint': ['yarn', 'lint'],
  'cargo:check': ['cargo', 'check'],
  'cargo:test': ['cargo', 'test'],
  'cargo:build': ['cargo', 'build'],
  'dotnet:restore': ['dotnet', 'restore'],
  'dotnet:build': ['dotnet', 'build'],
  'dotnet:test': ['dotnet', 'test'],
  'rg:*': ['rg', 'TODO', '.'],
  'grep:*': ['grep', '-R', 'TODO', '.'],
  'cat:*': ['cat', 'README.md'],
  'ls:*': ['ls', '-la'],
};

test('every documented safe matcher matches the family produced for its canonical example', () => {
  assert.equal(SAFE_COMMAND_MATCHERS.length, Object.keys(samples).length);
  for (const entry of SAFE_COMMAND_MATCHERS) {
    const argv = samples[entry.matcher];
    assert.ok(argv, `missing classifier sample for ${entry.matcher}`);
    const classification = classifyCommand(argv);
    assert.ok(
      glob(entry.matcher, classification.family),
      `${entry.matcher} does not match ${classification.family} for ${entry.example}`,
    );
    assert.equal(classification.risk, 'LOW', `${entry.matcher} is no longer LOW risk`);
  }
});

test('safe matcher catalog never recommends broad shell families', () => {
  const matchers = SAFE_COMMAND_MATCHERS.map((entry) => entry.matcher);
  for (const unsafe of ['shell:powershell', 'shell:bash', 'shell:sh', '*'])
    assert.ok(!matchers.includes(unsafe), `unsafe matcher ${unsafe} must not be recommended`);
});
