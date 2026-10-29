import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CommandAnalysis,
  CommandPolicyInput,
  YoloPolicy,
} from '../../../packages/protocol/src/command-analysis.js';
import { normalizeYoloPolicy } from '../../../packages/protocol/src/command-analysis.js';
import { decideCommand } from '../src/policy/command-decision.js';

function analysis(
  scope: 'inside' | 'outside' | 'unknown',
  risk = 'LOW',
  parseStatus: CommandAnalysis['parseStatus'] = 'complete',
): CommandAnalysis {
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
    },
    parseStatus,
    scope,
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
        cwdCandidates: ['/work'],
        modifiers: [],
        targets: [],
        effect: 'READ_ONLY',
        risk,
        scope,
        reasons: [],
      },
    ],
    edges: [],
    reasons: [],
    evidenceFingerprint: 'evi_1',
  };
}

function input(policy: YoloPolicy, overrides: Partial<CommandPolicyInput>): CommandPolicyInput {
  return {
    analysis: analysis('inside'),
    rules: [],
    authority: { valid: true, commandCapability: true, reasons: [] },
    network: { outcome: 'allow', reasons: [] },
    yolo: { active: true, ...policy },
    criticalAlwaysConfirm: false,
    scriptTrust: 'trusted',
    ...overrides,
  };
}

const DO_WORKSPACE: YoloPolicy = { mode: 'workspace', risk: 'do-whatever' };
const DO_ALL: YoloPolicy = { mode: 'unrestricted', risk: 'do-whatever' };
const PREVENT_ALL: YoloPolicy = { mode: 'unrestricted', risk: 'prevent-high-risk' };
const PREVENT_WORKSPACE: YoloPolicy = { mode: 'workspace', risk: 'prevent-high-risk' };

test('normalizeYoloPolicy defaults risk to prevent-high-risk', () => {
  assert.deepEqual(normalizeYoloPolicy({ mode: 'unrestricted' }), {
    mode: 'unrestricted',
    risk: 'prevent-high-risk',
  });
  assert.deepEqual(normalizeYoloPolicy(undefined), {
    mode: 'workspace',
    risk: 'prevent-high-risk',
  });
  assert.deepEqual(normalizeYoloPolicy({ mode: 'bogus', risk: 'nope' }), {
    mode: 'workspace',
    risk: 'prevent-high-risk',
  });
  assert.equal(normalizeYoloPolicy({ risk: 'do-whatever' }).risk, 'do-whatever');
});

test('do-whatever + workspace allows CRITICAL work inside the workspace', () => {
  const decision = decideCommand(input(DO_WORKSPACE, { analysis: analysis('inside', 'CRITICAL') }));
  assert.equal(decision.outcome, 'allow');
});

test('do-whatever + workspace still asks when the command is outside the workspace', () => {
  const decision: any = decideCommand(input(DO_WORKSPACE, { analysis: analysis('outside') }));
  assert.equal(decision.outcome, 'approval');
  assert.ok(decision.reasons.some((r: any) => r.code === 'OUTSIDE_WORKSPACE'));
});

test('do-whatever + unrestricted allows CRITICAL outside work', () => {
  const decision = decideCommand(input(DO_ALL, { analysis: analysis('outside', 'CRITICAL') }));
  assert.equal(decision.outcome, 'allow');
});

test('prevent-high-risk still confirms CRITICAL in both scopes', () => {
  for (const policy of [PREVENT_ALL, PREVENT_WORKSPACE]) {
    const decision = decideCommand(input(policy, { analysis: analysis('inside', 'CRITICAL') }));
    assert.equal(decision.outcome, 'approval');
  }
});

test('prevent + unrestricted keeps network deny for outside commands', () => {
  const decision = decideCommand(
    input(PREVENT_ALL, {
      analysis: analysis('outside'),
      network: { outcome: 'deny', reasons: [{ code: 'NETWORK_DESTINATION_DENIED', message: 'x' }] },
    }),
  );
  assert.equal(decision.outcome, 'deny');
});

test('prevent + unrestricted allows a plain outside command', () => {
  assert.equal(
    decideCommand(input(PREVENT_ALL, { analysis: analysis('outside') })).outcome,
    'allow',
  );
  assert.equal(
    decideCommand(input(PREVENT_ALL, { analysis: analysis('unknown') })).outcome,
    'allow',
  );
});

test('prevent + unrestricted keeps script trust, network approval and unsupported syntax', () => {
  const base = { analysis: analysis('outside') };
  assert.equal(
    decideCommand(input(PREVENT_ALL, { ...base, scriptTrust: 'unapproved' })).outcome,
    'approval',
  );
  assert.equal(
    decideCommand(input(PREVENT_ALL, { ...base, scriptTrust: 'changed' })).outcome,
    'approval',
  );
  assert.equal(
    decideCommand(input(PREVENT_ALL, { ...base, network: { outcome: 'approval', reasons: [] } }))
      .outcome,
    'approval',
  );
  assert.equal(
    decideCommand(input(PREVENT_ALL, { analysis: analysis('outside', 'LOW', 'partial') })).outcome,
    'approval',
  );
});

test('unrestricted is a superset of workspace for inside work', () => {
  const cases: Array<Partial<CommandPolicyInput>> = [
    {},
    { analysis: analysis('inside', 'LOW', 'partial') },
    { scriptTrust: 'changed' },
    { scriptTrust: 'unapproved' },
    { network: { outcome: 'approval', reasons: [] } },
  ];
  for (const overrides of cases) {
    const workspace = decideCommand(input(PREVENT_WORKSPACE, overrides)).outcome;
    const unrestricted = decideCommand(input(PREVENT_ALL, overrides)).outcome;
    assert.equal(workspace, 'allow');
    assert.equal(unrestricted, workspace);
  }
});

test('prevent + workspace is unchanged for inside work', () => {
  assert.equal(decideCommand(input(PREVENT_WORKSPACE, {})).outcome, 'allow');
});

test('inactive YOLO ignores the policy', () => {
  const decision = decideCommand(
    input(DO_ALL, { analysis: analysis('inside', 'CRITICAL'), yolo: { active: false, ...DO_ALL } }),
  );
  assert.equal(decision.outcome, 'approval');
});
