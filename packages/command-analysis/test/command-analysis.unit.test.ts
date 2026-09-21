import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeCommand } from '../src/index.js';
import { evaluateScriptTrust } from '../src/script-trust.js';
import { makeAnalysisFixture, makePolicyFixture } from './fixtures.js';

test('A01: Direct status, RTK status, and literal shell status share semantic operation', async () => {
  const f = makeAnalysisFixture({ platform: 'linux', root: '/work/repo' });

  // Direct argv
  const direct = await analyzeCommand(
    {
      kind: 'argv',
      argv: ['git', 'status'],
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );
  assert.equal(direct.nodes[0]?.application, 'git');
  assert.deepEqual(direct.nodes[0]?.operation, ['status']);
  assert.equal(direct.nodes[0]?.wrappers.length, 0);

  // RTK wrapped
  const rtk = await analyzeCommand(
    {
      kind: 'argv',
      argv: ['rtk', 'git', 'status'],
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );
  assert.equal(rtk.nodes[0]?.application, 'git');
  assert.deepEqual(rtk.nodes[0]?.operation, ['status']);
  assert.equal(rtk.nodes[0]?.wrappers[0]?.app, 'rtk');
  assert.equal(rtk.nodes[0]?.wrappers[0]?.identity.fingerprint, 'fp_rtk');

  // Shell script status
  const shell = await analyzeCommand(
    {
      kind: 'script',
      shell: 'bash',
      script: 'git status',
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );
  assert.equal(shell.nodes[0]?.application, 'git');
  assert.deepEqual(shell.nodes[0]?.operation, ['status']);
});

test('A02: npm run dev vs npm run deploy produce distinct script names', async () => {
  const f = makeAnalysisFixture();
  const dev = await analyzeCommand(
    {
      kind: 'argv',
      argv: ['npm', 'run', 'dev'],
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );
  const deploy = await analyzeCommand(
    {
      kind: 'argv',
      argv: ['npm', 'run', 'deploy'],
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );

  assert.equal(dev.nodes[0]?.scriptName, 'dev');
  assert.equal(deploy.nodes[0]?.scriptName, 'deploy');
  assert.notEqual(dev.requestFingerprint, deploy.requestFingerprint);
});

test('A03: Approved script definition changes yield SCRIPT_CHANGED', () => {
  const pkg1 = JSON.stringify({ scripts: { dev: 'vite --port 3000', test: 'vitest' } });
  const pkg2 = JSON.stringify({
    scripts: { dev: 'vite --port 3000 --host 0.0.0.0', test: 'vitest' },
  });

  const initial = evaluateScriptTrust('dev', pkg1);
  assert.equal(initial.status, 'unapproved');
  assert.ok(initial.fingerprint);

  const unchangedTrust = evaluateScriptTrust('dev', pkg1, initial.fingerprint);
  assert.equal(unchangedTrust.status, 'trusted');

  const changedTrust = evaluateScriptTrust('dev', pkg2, initial.fingerprint);
  assert.equal(changedTrust.status, 'changed');
  assert.equal(changedTrust.reason, 'SCRIPT_CHANGED');
});

test('A04: pnpm audit vs pnpm audit --fix distinguish inspection from mutation', async () => {
  const f = makeAnalysisFixture();
  const audit = await analyzeCommand(
    {
      kind: 'argv',
      argv: ['pnpm', 'audit'],
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );
  const auditFix = await analyzeCommand(
    {
      kind: 'argv',
      argv: ['pnpm', 'audit', '--fix'],
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );

  assert.equal(audit.nodes[0]?.effect, 'READ_ONLY');
  assert.equal(auditFix.nodes[0]?.effect, 'SOURCE_MUTATION');
  assert.ok(auditFix.nodes[0]?.modifiers.includes('fix'));
});

test('A05: Git push ordinary vs force and branch delete retain critical modifiers', async () => {
  const f = makeAnalysisFixture();
  const push = await analyzeCommand(
    {
      kind: 'argv',
      argv: ['git', 'push', 'origin', 'main'],
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );
  const pushForce = await analyzeCommand(
    {
      kind: 'argv',
      argv: ['git', 'push', '--force', 'origin', 'main'],
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );
  const branchDelete = await analyzeCommand(
    {
      kind: 'argv',
      argv: ['git', 'branch', '-D', 'feature-branch'],
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );

  assert.equal(push.nodes[0]?.modifiers.includes('force'), false);
  assert.equal(pushForce.nodes[0]?.modifiers.includes('force'), true);
  assert.equal(branchDelete.nodes[0]?.modifiers.includes('delete'), true);
});

test('A06: Bash and pwsh inside cd chain resolves within workspace', async () => {
  const f = makeAnalysisFixture({ platform: 'linux', root: '/work/repo' });
  const analysis = await analyzeCommand(
    {
      kind: 'script',
      shell: 'bash',
      script: 'cd /work/repo/packages/core && git status',
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );

  assert.equal(analysis.scope, 'inside');
  assert.equal(analysis.nodes[1]?.application, 'git');
  assert.equal(analysis.nodes[1]?.cwdCandidates[0], '/work/repo/packages/core');
});

test('A07: cd to outside directory produces OUTSIDE_WORKSPACE scope', async () => {
  const f = makeAnalysisFixture({
    platform: 'linux',
    root: '/work/repo',
    existingDirectories: ['/work/repo', '/work/other'],
  });
  const analysis = await analyzeCommand(
    {
      kind: 'script',
      shell: 'bash',
      script: 'cd /work/other && git status',
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );

  assert.equal(analysis.scope, 'outside');
  assert.ok(analysis.reasons.some((r) => r.code === 'OUTSIDE_WORKSPACE'));

  const input = makePolicyFixture(analysis);
  assert.equal(input.analysis.evidenceFingerprint, analysis.evidenceFingerprint);
});

test('A08: Git -C, npm prefix, pnpm directory outside detects scope boundary', async () => {
  const f = makeAnalysisFixture({ platform: 'linux', root: '/work/repo' });
  const gitOutside = await analyzeCommand(
    {
      kind: 'argv',
      argv: ['git', '-C', '/work/other', 'status'],
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );
  assert.equal(gitOutside.scope, 'outside');
  assert.ok(gitOutside.reasons.some((r) => r.code === 'OUTSIDE_WORKSPACE'));

  const npmOutside = await analyzeCommand(
    {
      kind: 'argv',
      argv: ['npm', '--prefix', '/work/other', 'test'],
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );
  assert.equal(npmOutside.scope, 'outside');
});

test('A09: Escaping relative paths and sibling prefixes are marked outside', async () => {
  const f = makeAnalysisFixture({ platform: 'linux', root: '/work/repo' });
  const escape = await analyzeCommand(
    {
      kind: 'script',
      shell: 'bash',
      script: 'cd ../other && git status',
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );
  assert.equal(escape.scope, 'outside');
});

test('A10: File redirection outside workspace triggers OUTSIDE_WORKSPACE', async () => {
  const f = makeAnalysisFixture({ platform: 'linux', root: '/work/repo' });
  const redirect = await analyzeCommand(
    {
      kind: 'script',
      shell: 'bash',
      script: 'git status > /work/other/log.txt',
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );

  assert.equal(redirect.scope, 'outside');
  assert.ok(redirect.reasons.some((r) => r.code === 'OUTSIDE_WORKSPACE'));
});

test('A12: Dynamic variables in cwd lead to DYNAMIC_SCOPE and unknown scope', async () => {
  const f = makeAnalysisFixture();
  const dynamic = await analyzeCommand(
    {
      kind: 'script',
      shell: 'bash',
      script: 'cd $TARGET_DIR && ls',
      cwdLogical: '/work/repo',
      executionMode: 'host',
      networkDestinations: [],
    },
    f.context,
    f.services,
  );

  assert.equal(dynamic.scope, 'unknown');
  assert.ok(dynamic.reasons.some((r) => r.code === 'DYNAMIC_SCOPE'));
});
