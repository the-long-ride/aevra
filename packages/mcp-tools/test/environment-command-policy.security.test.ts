import { explicitEnvironmentFingerprint } from '../src/command-environment-binding.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateAndDecideCommand } from '../src/command-decision-bridge.js';

test('remembered typed command permission is bound to the explicit environment', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aevra-env-policy-'));
  let rules: any[] = [];
  const context: any = {
    sessions: {
      get: () => ({ actor: 'operator' }),
      activeLease: () => ({ workspaceId: 'one', capabilities: ['commands.run'] }),
    },
    workspaces: {
      getLocal: () => ({ hostRoot: root }),
      capabilityRoots: () => [
        { id: 'root', logicalPrefix: '/', hostRoot: root, capabilities: ['commands.run'] },
      ],
    },
    deps: { permissions: { listRules: () => rules } },
  };
  const evaluate = (env: Record<string, string>) =>
    evaluateAndDecideCommand(context, 'session', {
      commandRequest: {
        kind: 'argv',
        executable: process.execPath,
        argv: [process.execPath, '--version'],
        cwdLogical: '/',
        executionMode: 'host',
        env,
      },
      permissionMatcher: 'node:--version',
      rawDestinations: [],
      isYolo: false,
      yoloMode: 'workspace',
    });
  try {
    const initial = await evaluate({ PROJECT_MODE: 'ordinary words' });
    assert.equal(initial.decision.outcome, 'approval');
    const predicate =
      initial.decision.outcome === 'approval' ? initial.decision.suggestedRules[0] : null;
    assert.ok(predicate?.explicitEnvFingerprint);
    rules = [
      {
        version: 2,
        id: 'rule',
        effect: 'allow',
        capability: 'commands.run',
        scope: 'workspace',
        workspaceId: 'one',
        predicate_json: JSON.stringify(predicate),
      },
    ];
    assert.equal((await evaluate({ PROJECT_MODE: 'ordinary words' })).decision.outcome, 'allow');
    assert.equal(
      (await evaluate({ PROJECT_MODE: 'different words' })).decision.outcome,
      'approval',
    );
    assert.equal(
      (await evaluate({ ADDITIONAL_MODE: 'ordinary words' })).decision.outcome,
      'approval',
    );
    const lowerCase = await evaluate({ project_mode: 'ordinary words' });
    assert.equal(lowerCase.decision.outcome, process.platform === 'win32' ? 'allow' : 'approval');
    const pathOverride = await evaluate({ PATH: path.dirname(process.execPath) });
    assert.ok(pathOverride.analysis.nodes.every((node) => node.risk === 'HIGH'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('POSIX command rules distinguish environment names that differ by case', () => {
  for (const platform of ['linux', 'darwin'])
    assert.notEqual(
      explicitEnvironmentFingerprint({ git_external_diff: './helper' }, platform),
      explicitEnvironmentFingerprint({ GIT_EXTERNAL_DIFF: './helper' }, platform),
    );
  assert.equal(
    explicitEnvironmentFingerprint({ project_mode: 'ordinary', SECOND: 'words' }, 'win32'),
    explicitEnvironmentFingerprint({ second: 'words', PROJECT_MODE: 'ordinary' }, 'win32'),
  );
});
