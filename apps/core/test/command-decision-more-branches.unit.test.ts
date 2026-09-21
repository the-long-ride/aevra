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

test('command-decision: exact approval and critical checks with yolo combinations', () => {
  // Exact approval already consumed
  const consumedApproval = makeInput({
    exactApproval: {
      ticketId: 't1',
      requestFingerprint: 'req_1',
      evidenceFingerprint: 'evi_1',
      consumed: true,
      authorityVerified: true,
    },
  });
  assert.equal(decideCommand(consumedApproval).outcome, 'deny');

  // Fingerprint mismatch (context changed)
  const changedEvidence = makeInput({
    exactApproval: {
      ticketId: 't1',
      requestFingerprint: 'req_1',
      evidenceFingerprint: 'evi_changed',
      consumed: false,
      authorityVerified: true,
    },
  });
  assert.equal(decideCommand(changedEvidence).outcome, 'approval');

  // Valid exact approval verified
  const validApproval = makeInput({
    exactApproval: {
      ticketId: 't1',
      requestFingerprint: 'req_1',
      evidenceFingerprint: 'evi_1',
      consumed: false,
      authorityVerified: true,
    },
  });
  assert.equal(decideCommand(validApproval).outcome, 'allow');

  // Critical node with criticalAlwaysConfirm
  const criticalAnalysis = makeAnalysis({
    nodes: [{ ...makeAnalysis().nodes[0]!, risk: 'CRITICAL' }],
  });
  assert.equal(
    decideCommand(
      makeInput({
        analysis: criticalAnalysis,
        criticalAlwaysConfirm: true,
        yolo: { active: true, mode: 'unrestricted' },
      }),
    ).outcome,
    'approval',
  );

  // Critical node still requires approval under unrestricted YOLO
  assert.equal(
    decideCommand(
      makeInput({
        analysis: criticalAnalysis,
        criticalAlwaysConfirm: false,
        yolo: { active: true, mode: 'unrestricted' },
      }),
    ).outcome,
    'approval',
  );

  // Critical node with workspace YOLO requires approval
  assert.equal(
    decideCommand(
      makeInput({
        analysis: criticalAnalysis,
        criticalAlwaysConfirm: false,
        yolo: { active: true, mode: 'workspace' },
      }),
    ).outcome,
    'approval',
  );

  // Scope outside or unknown with unrestricted YOLO vs workspace YOLO
  const outsideAnalysis = makeAnalysis({ scope: 'outside' });
  assert.equal(
    decideCommand(
      makeInput({ analysis: outsideAnalysis, yolo: { active: true, mode: 'unrestricted' } }),
    ).outcome,
    'allow',
  );
  assert.equal(
    decideCommand(
      makeInput({ analysis: outsideAnalysis, yolo: { active: true, mode: 'workspace' } }),
    ).outcome,
    'approval',
  );

  const unknownAnalysis = makeAnalysis({ scope: 'unknown' });
  assert.equal(
    decideCommand(
      makeInput({ analysis: unknownAnalysis, yolo: { active: true, mode: 'unrestricted' } }),
    ).outcome,
    'allow',
  );
  assert.equal(
    decideCommand(
      makeInput({ analysis: unknownAnalysis, yolo: { active: true, mode: 'workspace' } }),
    ).outcome,
    'approval',
  );

  // Script trust changed
  assert.equal(
    decideCommand(
      makeInput({ scriptTrust: 'changed', yolo: { active: true, mode: 'unrestricted' } }),
    ).outcome,
    'allow',
  );
  assert.equal(
    decideCommand(makeInput({ scriptTrust: 'changed', yolo: { active: true, mode: 'workspace' } }))
      .outcome,
    'allow',
  );

  // Network approval outcome
  assert.equal(
    decideCommand(
      makeInput({
        network: { outcome: 'approval', reasons: [] },
        yolo: { active: true, mode: 'unrestricted' },
      }),
    ).outcome,
    'allow',
  );
  assert.equal(
    decideCommand(
      makeInput({
        network: { outcome: 'approval', reasons: [] },
        yolo: { active: true, mode: 'workspace' },
      }),
    ).outcome,
    'allow',
  );

  // Unapproved package scripts are allowed in workspace YOLO when analysis proves
  // the command stays inside the workspace.
  assert.equal(
    decideCommand(
      makeInput({
        scriptTrust: 'unapproved',
        yolo: { active: true, mode: 'workspace' },
      }),
    ).outcome,
    'allow',
  );

  // Unsupported syntax is also bypassed only when workspace scope is still
  // conclusively inside. Unknown scope remains approval-gated.
  assert.equal(
    decideCommand(
      makeInput({
        analysis: makeAnalysis({ parseStatus: 'unsupported', scope: 'inside' }),
        yolo: { active: true, mode: 'workspace' },
      }),
    ).outcome,
    'allow',
  );
  assert.equal(
    decideCommand(
      makeInput({
        analysis: makeAnalysis({ parseStatus: 'unsupported', scope: 'unknown' }),
        yolo: { active: true, mode: 'workspace' },
      }),
    ).outcome,
    'approval',
  );
  assert.equal(
    decideCommand(
      makeInput({
        analysis: makeAnalysis({ parseStatus: 'unsupported', scope: 'unknown' }),
        yolo: { active: true, mode: 'unrestricted' },
      }),
    ).outcome,
    'allow',
  );

  // Network deny is ordinary command policy and is bypassed by YOLO
  // whenever the command itself is within the selected YOLO scope.
  assert.equal(
    decideCommand(
      makeInput({
        network: { outcome: 'deny', reasons: [] },
        yolo: { active: true, mode: 'workspace' },
      }),
    ).outcome,
    'allow',
  );
  assert.equal(
    decideCommand(
      makeInput({
        network: { outcome: 'deny', reasons: [] },
        yolo: { active: true, mode: 'unrestricted' },
      }),
    ).outcome,
    'allow',
  );

  // Missing command capability requires approval
  assert.equal(
    decideCommand(makeInput({ authority: { valid: true, commandCapability: false, reasons: [] } }))
      .outcome,
    'approval',
  );
});

test('command-rule-migration: handles edge cases and package managers', () => {
  assert.equal(convertLegacyMatcher('*:*', 'allow').status, 'needs-review');
  assert.equal(convertLegacyMatcher('', 'allow').status, 'needs-review');
  assert.equal(convertLegacyMatcher('git', 'allow').status, 'needs-review');
  assert.equal(convertLegacyMatcher('npm', 'allow').status, 'needs-review');
  assert.equal(convertLegacyMatcher('pnpm:test', 'allow').status, 'active');
  assert.equal(convertLegacyMatcher('yarn:run:build', 'allow').status, 'active');
  assert.equal(convertLegacyMatcher('bun:install', 'allow').status, 'active');
  assert.equal(convertLegacyMatcher('unknown:app:test', 'allow').status, 'needs-review');
});
