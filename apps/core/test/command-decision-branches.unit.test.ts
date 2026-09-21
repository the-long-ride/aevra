import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CommandAnalysis,
  CommandPolicyInput,
  CommandRuleV2,
} from '../../../packages/protocol/src/command-analysis.js';
import { decideCommand } from '../src/policy/command-decision.js';
import { convertLegacyMatcher } from '../src/policy/command-rule-migration.js';

function makeAnalysis(overrides: Partial<CommandAnalysis> = {}): CommandAnalysis {
  return {
    version: 1,
    requestFingerprint: 'req_1',
    context: {
      actor: 'operator',
      sessionId: 'ses_1',
      workspaceId: 'ws_1',
      rootsRevision: '1',
      platform: 'linux',
      backendId: 'host',
      backendRevision: '1',
      policyRevision: '1',
      environmentFingerprint: 'env_1',
      resolverGeneration: '1',
      workspaceRoot: '/work/repo',
    },
    parseStatus: 'complete',
    scope: 'inside',
    nodes: [
      {
        id: 'node_1',
        dialect: 'direct',
        argv: ['git', 'status'],
        wrappers: [],
        application: 'git',
        operation: ['status'],
        options: [],
        forwardedArgv: [],
        cwdCandidates: ['/work/repo'],
        modifiers: [],
        targets: [],
        effect: 'READ_ONLY',
        risk: 'LOW',
        scope: 'inside',
        reasons: [],
      },
    ],
    edges: [],
    reasons: [],
    evidenceFingerprint: 'evi_1',
    ...overrides,
  };
}

function makeInput(overrides: Partial<CommandPolicyInput> = {}): CommandPolicyInput {
  return {
    analysis: makeAnalysis(),
    rules: [],
    authority: { valid: true, commandCapability: true, reasons: [] },
    network: { outcome: 'allow', reasons: [] },
    yolo: { active: false, mode: 'workspace' },
    criticalAlwaysConfirm: false,
    scriptTrust: 'trusted',
    ...overrides,
  };
}

test('command-decision: rule predicate matching constraints', () => {
  const baseRule: CommandRuleV2 = {
    version: 2,
    application: 'git',
    operation: ['status'],
    allowedModifiers: ['force'],
    allowedOptions: [{ name: '-v' }],
    positionalConstraint: 'workspace-paths',
    targetScope: 'workspace',
    backends: ['host'],
    dialects: ['direct'],
    executableFingerprint: 'exe_fp_git',
    wrapperFingerprints: ['*'],
    scriptFingerprint: 'scr_fp_1',
  };

  const baseAnalysis = makeAnalysis({
    nodes: [
      {
        ...makeAnalysis().nodes[0]!,
        executable: {
          logicalName: 'git',
          canonicalPath: '/bin/git',
          launcher: 'native',
          fingerprint: 'exe_fp_git',
          provenance: 'installed',
          backendId: 'host',
        },
        scriptFingerprint: 'scr_fp_1',
      },
    ],
  });
  const wrapRule = (predicate: CommandRuleV2, effect: 'allow' | 'deny' = 'allow') => ({
    id: 'rule_1',
    effect,
    predicate,
    scope: 'workspace' as const,
    workspaceId: 'ws_1',
  });

  // Mismatched operation
  const ruleOpMismatch = wrapRule({ ...baseRule, operation: ['diff'] });
  assert.equal(
    decideCommand(makeInput({ analysis: baseAnalysis, rules: [ruleOpMismatch] })).outcome,
    'approval',
  );

  // Operation wildcard match
  const ruleOpWildcard = wrapRule({ ...baseRule, operation: ['*'] });
  assert.equal(
    decideCommand(makeInput({ analysis: baseAnalysis, rules: [ruleOpWildcard] })).outcome,
    'allow',
  );

  // Script name matching
  const ruleScriptNameMismatch = wrapRule({ ...baseRule, scriptName: 'build' });
  assert.equal(
    decideCommand(makeInput({ analysis: baseAnalysis, rules: [ruleScriptNameMismatch] })).outcome,
    'approval',
  );

  // Modifier constraint
  const analysisWithMod = makeAnalysis({
    nodes: [{ ...baseAnalysis.nodes[0]!, modifiers: ['unallowed_mod'] }],
  });
  assert.equal(
    decideCommand(makeInput({ analysis: analysisWithMod, rules: [wrapRule(baseRule)] })).outcome,
    'approval',
  );

  // Allowed modifier wildcard
  const ruleModWildcard = wrapRule({ ...baseRule, allowedModifiers: ['*'] });
  assert.equal(
    decideCommand(makeInput({ analysis: analysisWithMod, rules: [ruleModWildcard] })).outcome,
    'allow',
  );

  // Option constraint
  const analysisWithOpt = makeAnalysis({
    nodes: [{ ...baseAnalysis.nodes[0]!, options: [{ name: '--bad-opt', sourceIndex: 2 }] }],
  });
  assert.equal(
    decideCommand(makeInput({ analysis: analysisWithOpt, rules: [wrapRule(baseRule)] })).outcome,
    'approval',
  );

  // Option wildcard
  const ruleOptWildcard = wrapRule({ ...baseRule, allowedOptions: [{ name: '*' }] });
  assert.equal(
    decideCommand(makeInput({ analysis: analysisWithOpt, rules: [ruleOptWildcard] })).outcome,
    'allow',
  );

  // Backend constraint
  const ruleBackendMismatch = wrapRule({ ...baseRule, backends: ['docker'] });
  assert.equal(
    decideCommand(makeInput({ analysis: baseAnalysis, rules: [ruleBackendMismatch] })).outcome,
    'approval',
  );

  // Dialect constraint
  const ruleDialectMismatch = wrapRule({ ...baseRule, dialects: ['bash'] });
  assert.equal(
    decideCommand(makeInput({ analysis: baseAnalysis, rules: [ruleDialectMismatch] })).outcome,
    'approval',
  );

  // Executable fingerprint constraint
  const analysisWithExeFp = makeAnalysis({
    nodes: [
      {
        ...baseAnalysis.nodes[0]!,
        executable: {
          logicalName: 'git',
          canonicalPath: '/bin/git',
          launcher: 'native',
          fingerprint: 'exe_fp_diff',
          provenance: 'installed',
          backendId: 'host',
        },
      },
    ],
  });
  assert.equal(
    decideCommand(makeInput({ analysis: analysisWithExeFp, rules: [wrapRule(baseRule)] })).outcome,
    'approval',
  );

  // Script fingerprint constraint
  const analysisWithScrFp = makeAnalysis({
    nodes: [{ ...baseAnalysis.nodes[0]!, scriptFingerprint: 'scr_fp_other' }],
  });
  assert.equal(
    decideCommand(makeInput({ analysis: analysisWithScrFp, rules: [wrapRule(baseRule)] })).outcome,
    'approval',
  );

  // Target scope constraint
  const analysisOutside = makeAnalysis({
    nodes: [{ ...baseAnalysis.nodes[0]!, scope: 'outside' }],
  });
  assert.equal(
    decideCommand(makeInput({ analysis: analysisOutside, rules: [wrapRule(baseRule)] })).outcome,
    'approval',
  );
});

test('command-decision: rule applicability filters by expiry, session, workspace, actor', () => {
  const baseRule: CommandRuleV2 = {
    version: 2,
    application: 'git',
    operation: ['status'],
    allowedModifiers: [],
    allowedOptions: [],
    positionalConstraint: 'workspace-paths',
    targetScope: 'workspace',
    backends: ['host'],
    dialects: ['direct'],
    executableFingerprint: '*',
    wrapperFingerprints: ['*'],
  };

  // Expired rule
  const expired = {
    id: 'r_exp',
    effect: 'allow' as const,
    predicate: baseRule,
    scope: 'workspace' as const,
    expiresAt: '2020-01-01T00:00:00.000Z',
  };
  assert.equal(decideCommand(makeInput({ rules: [expired] })).outcome, 'approval');

  // Session mismatch
  const wrongSession = {
    id: 'r_ses',
    effect: 'allow' as const,
    predicate: baseRule,
    scope: 'session' as const,
    sessionId: 'other_ses',
  };
  assert.equal(decideCommand(makeInput({ rules: [wrongSession] })).outcome, 'approval');

  // Workspace mismatch
  const wrongWs = {
    id: 'r_ws',
    effect: 'allow' as const,
    predicate: baseRule,
    scope: 'workspace' as const,
    workspaceId: 'other_ws',
  };
  assert.equal(decideCommand(makeInput({ rules: [wrongWs] })).outcome, 'approval');

  // Actor mismatch
  const wrongActor = {
    id: 'r_act',
    effect: 'allow' as const,
    predicate: baseRule,
    scope: 'workspace' as const,
    actor: 'other_actor',
  };
  assert.equal(decideCommand(makeInput({ rules: [wrongActor] })).outcome, 'approval');
});
