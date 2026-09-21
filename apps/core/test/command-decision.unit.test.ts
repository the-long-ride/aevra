import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CommandAnalysis,
  CommandPolicyInput,
  CommandRuleV2,
} from '../../../packages/protocol/src/command-analysis.js';
import { bindCommandApproval, consumeCommandApproval } from '../src/approvals/command-binding.js';
import { decideCommand } from '../src/policy/command-decision.js';

function makeMockAnalysis(overrides: Partial<CommandAnalysis> = {}): CommandAnalysis {
  return {
    version: 1,
    requestFingerprint: 'req_fp_1',
    context: {
      actor: 'test-actor',
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
        dialect: 'bash',
        argv: ['git', 'status'],
        wrappers: [],
        application: 'git',
        operation: ['status'],
        options: [],
        forwardedArgv: [],
        cwdCandidates: ['/work/repo'],
        modifiers: [],
        targets: [],
        effect: 'read',
        risk: 'LOW',
        scope: 'inside',
        reasons: [],
      },
    ],
    edges: [],
    reasons: [],
    evidenceFingerprint: 'evi_fp_1',
    ...overrides,
  };
}

function makePolicyInput(overrides: Partial<CommandPolicyInput> = {}): CommandPolicyInput {
  return {
    analysis: makeMockAnalysis(),
    rules: [],
    authority: { valid: true, commandCapability: true, reasons: [] },
    network: { outcome: 'allow', reasons: [] },
    yolo: { active: false, mode: 'workspace' },
    criticalAlwaysConfirm: false,
    scriptTrust: 'trusted',
    ...overrides,
  };
}

test('Selected DENY applies normally but active YOLO overrides it inside its scope', () => {
  const deniedInput = makePolicyInput({
    selectedLegacyDecision: { outcome: 'deny', reason: 'Blocked by administrator' },
  });

  assert.equal(decideCommand(deniedInput).outcome, 'deny');

  deniedInput.yolo = { active: true, mode: 'workspace' };
  assert.equal(decideCommand(deniedInput).outcome, 'allow');

  deniedInput.yolo = { active: true, mode: 'unrestricted' };
  assert.equal(decideCommand(deniedInput).outcome, 'allow');
});

test('Authority invalid or missing commands capability yields deny', () => {
  const noAuth = makePolicyInput({
    authority: {
      valid: false,
      commandCapability: false,
      reasons: [{ code: 'NO_LEASE', message: 'No active lease' }],
    },
  });
  assert.equal(decideCommand(noAuth).outcome, 'deny');
});

test('Parse status invalid produces invalid outcome', () => {
  const invalidReq = makePolicyInput({
    analysis: makeMockAnalysis({ parseStatus: 'invalid' }),
  });
  assert.equal(decideCommand(invalidReq).outcome, 'invalid');
});

test('Outside workspace requires approval in ordinary and workspace YOLO, waived in unrestricted', () => {
  const outsideAnalysis = makeMockAnalysis({
    scope: 'outside',
    reasons: [{ code: 'OUTSIDE_WORKSPACE', message: 'Outside workspace root' }],
  });

  // YOLO inactive
  const inputInactive = makePolicyInput({
    analysis: outsideAnalysis,
    yolo: { active: false, mode: 'workspace' },
  });
  assert.equal(decideCommand(inputInactive).outcome, 'approval');

  // Workspace YOLO active -> MUST NOT waive scope prompt
  const inputWorkspaceYolo = makePolicyInput({
    analysis: outsideAnalysis,
    yolo: { active: true, mode: 'workspace' },
  });
  assert.equal(decideCommand(inputWorkspaceYolo).outcome, 'approval');

  // Unrestricted YOLO active -> scope prompt is waived
  const inputUnrestricted = makePolicyInput({
    analysis: outsideAnalysis,
    yolo: { active: true, mode: 'unrestricted' },
  });
  assert.equal(decideCommand(inputUnrestricted).outcome, 'allow');
});

test('Dynamic or unknown scope requires approval under workspace YOLO', () => {
  const unknownAnalysis = makeMockAnalysis({
    scope: 'unknown',
    reasons: [{ code: 'DYNAMIC_SCOPE', message: 'Unknown dynamic variable' }],
  });

  const inputWorkspaceYolo = makePolicyInput({
    analysis: unknownAnalysis,
    yolo: { active: true, mode: 'workspace' },
  });
  assert.equal(decideCommand(inputWorkspaceYolo).outcome, 'approval');

  const inputUnrestricted = makePolicyInput({
    analysis: unknownAnalysis,
    yolo: { active: true, mode: 'unrestricted' },
  });
  assert.equal(decideCommand(inputUnrestricted).outcome, 'allow');
});

test('Changed project script follows the selected YOLO scope', () => {
  const inputWorkspaceYolo = makePolicyInput({
    scriptTrust: 'changed',
    yolo: { active: true, mode: 'workspace' },
  });
  assert.equal(decideCommand(inputWorkspaceYolo).outcome, 'allow');

  const inputUnrestricted = makePolicyInput({
    scriptTrust: 'changed',
    yolo: { active: true, mode: 'unrestricted' },
  });
  assert.equal(decideCommand(inputUnrestricted).outcome, 'allow');
});

test('Mandatory critical confirmation requires approval even in unrestricted mode', () => {
  const criticalAnalysis = makeMockAnalysis({
    nodes: [
      {
        id: 'node_1',
        dialect: 'bash',
        argv: ['git', 'push', '--force'],
        wrappers: [],
        application: 'git',
        operation: ['push'],
        options: [],
        forwardedArgv: [],
        cwdCandidates: ['/work/repo'],
        modifiers: ['force'],
        targets: [],
        effect: 'write',
        risk: 'CRITICAL',
        scope: 'inside',
        reasons: [],
      },
    ],
  });

  const criticalInput = makePolicyInput({
    analysis: criticalAnalysis,
    selectedLegacyDecision: { outcome: 'deny', reason: 'remembered deny' },
    criticalAlwaysConfirm: true,
    yolo: { active: true, mode: 'unrestricted' },
  });
  assert.equal(decideCommand(criticalInput).outcome, 'approval');
});

test('critical YOLO resumes only the exact operator-approved command evidence', () => {
  const analysis = makeMockAnalysis({
    nodes: [{ ...makeMockAnalysis().nodes[0]!, risk: 'CRITICAL', effect: 'write' }],
  });
  const exactApproval = {
    ticketId: 'req_critical',
    requestFingerprint: analysis.requestFingerprint,
    evidenceFingerprint: analysis.evidenceFingerprint,
    authorityVerified: true,
    consumed: false,
  };

  assert.equal(
    decideCommand(
      makePolicyInput({
        analysis,
        yolo: { active: true, mode: 'unrestricted' },
        exactApproval,
      }),
    ).outcome,
    'allow',
  );

  assert.equal(
    decideCommand(
      makePolicyInput({
        analysis,
        yolo: { active: true, mode: 'unrestricted' },
        exactApproval: { ...exactApproval, authorityVerified: false },
      }),
    ).outcome,
    'approval',
  );

  assert.equal(
    decideCommand(
      makePolicyInput({
        analysis,
        yolo: { active: true, mode: 'unrestricted' },
        exactApproval: { ...exactApproval, consumed: true },
      }),
    ).outcome,
    'deny',
  );
});

test('Typed rule matching grants allow without prompt in ordinary mode', () => {
  const analysis = makeMockAnalysis();
  const rule: CommandRuleV2 = {
    version: 2,
    application: 'git',
    operation: ['status'],
    allowedModifiers: [],
    allowedOptions: [],
    positionalConstraint: 'workspace-paths',
    targetScope: 'workspace',
    backends: ['host'],
    dialects: ['bash'],
    executableFingerprint: '*',
    wrapperFingerprints: [],
  };

  const input = makePolicyInput({
    analysis,
    yolo: { active: false, mode: 'workspace' },
    rules: [
      {
        id: 'rule_1',
        effect: 'allow',
        predicate: rule,
        scope: 'workspace',
        workspaceId: 'ws_1',
      },
    ],
  });

  const decision = decideCommand(input);
  assert.equal(decision.outcome, 'allow');
  assert.deepEqual(decision.ruleIds, ['rule_1']);
});
