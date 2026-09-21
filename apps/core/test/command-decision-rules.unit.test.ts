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

test('typed rules enforce exact argv, option values, wrappers, pinned evidence, and scope ids', () => {
  const identity = {
    logicalName: 'tool',
    canonicalPath: '/work/repo/tool',
    launcher: 'native' as const,
    fingerprint: 'exe-fp',
    provenance: 'workspace' as const,
    backendId: 'host',
  };
  const wrapperIdentity = { ...identity, logicalName: 'wrapper', fingerprint: 'wrapper-fp' };
  const node = {
    ...makeMockAnalysis().nodes[0]!,
    argv: ['tool', 'run', '--format', 'json'],
    executable: identity,
    wrappers: [{ app: 'wrapper', identity: wrapperIdentity, mappingVersion: '1' }],
    application: 'tool',
    operation: ['run'],
    scriptName: 'build',
    options: [{ name: '--format', value: 'json', sourceIndex: 2 }],
    scriptFingerprint: 'script-fp',
  };
  const analysis = makeMockAnalysis({ nodes: [node] });
  const predicate: CommandRuleV2 = {
    version: 2,
    application: 'tool',
    operation: ['run'],
    scriptName: 'build',
    allowedModifiers: [],
    allowedOptions: [{ name: '--format', values: ['json'] }],
    positionalConstraint: 'exact',
    exactArgv: ['tool', 'run', '--format', 'json'],
    targetScope: 'workspace',
    backends: ['host'],
    dialects: ['bash'],
    executableFingerprint: 'exe-fp',
    wrapperFingerprints: ['wrapper-fp'],
    scriptFingerprint: 'script-fp',
  };
  const decide = (rule: any, currentAnalysis: CommandAnalysis = analysis, scope: any = {}) =>
    decideCommand(
      makePolicyInput({
        analysis: currentAnalysis,
        rules: [
          {
            id: 'strict',
            effect: 'allow',
            predicate: rule,
            scope: scope.scope ?? 'workspace',
            workspaceId: scope.workspaceId,
            sessionId: scope.sessionId,
          },
        ],
      }),
    ).outcome;

  assert.equal(decide(predicate, analysis, { workspaceId: 'ws_1' }), 'allow');
  assert.equal(
    decide({ ...predicate, exactArgv: ['tool', 'run'] }, analysis, { workspaceId: 'ws_1' }),
    'approval',
  );
  assert.equal(
    decide({ ...predicate, allowedOptions: [{ name: '--format', values: ['text'] }] }, analysis, {
      workspaceId: 'ws_1',
    }),
    'approval',
  );
  assert.equal(
    decide({ ...predicate, wrapperFingerprints: ['other'] }, analysis, { workspaceId: 'ws_1' }),
    'approval',
  );
  assert.equal(
    decide(predicate, makeMockAnalysis({ nodes: [{ ...node, executable: undefined }] }), {
      workspaceId: 'ws_1',
    }),
    'approval',
  );
  assert.equal(
    decide(predicate, makeMockAnalysis({ nodes: [{ ...node, scriptFingerprint: undefined }] }), {
      workspaceId: 'ws_1',
    }),
    'approval',
  );
  assert.equal(decide(predicate, analysis, { scope: 'workspace' }), 'approval');
  assert.equal(decide(predicate, analysis, { scope: 'session' }), 'approval');
  assert.equal(
    decide({ ...predicate, allowedOptions: 'malformed' } as any, analysis, { workspaceId: 'ws_1' }),
    'approval',
  );
});

test('A16/A17: Command approval binding enforces exact single-use consumption', () => {
  const analysis = makeMockAnalysis();
  const ticketId = 'appr_ticket_123';

  // Bind approval
  bindCommandApproval(ticketId, analysis, 'ses_1', 'ws_1');

  // Exact match consumes successfully
  const firstConsume = consumeCommandApproval(ticketId, analysis);
  assert.equal(firstConsume.ok, true);

  // Second consume fails (single-use authority)
  const secondConsume = consumeCommandApproval(ticketId, analysis);
  assert.equal(secondConsume.ok, false);

  // Changed evidence fails consume
  const ticket2 = 'appr_ticket_456';
  bindCommandApproval(ticket2, analysis, 'ses_1', 'ws_1');
  const modifiedAnalysis = makeMockAnalysis({
    context: { ...analysis.context, rootsRevision: 'changed_roots' },
    evidenceFingerprint: 'changed_evidence',
  });
  const changedConsume = consumeCommandApproval(ticket2, modifiedAnalysis);
  assert.equal(changedConsume.ok, false);
});

test('command-decision branches: network approval, deny rules, dynamic scope, and expired rules', () => {
  const analysis = makeMockAnalysis();

  // 1. Network approval
  const netInput = makePolicyInput({
    analysis,
    network: { outcome: 'approval', reasons: [{ code: 'NET_APPROVAL', message: 'net' }] },
    yolo: { active: false, mode: 'workspace' },
  });
  assert.equal(decideCommand(netInput).outcome, 'approval');

  // 2. Deny rule
  const denyInput = makePolicyInput({
    analysis,
    rules: [
      {
        id: 'deny_1',
        effect: 'deny',
        predicate: {
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
        },
        scope: 'workspace',
        workspaceId: 'ws_1',
      },
    ],
  });
  assert.equal(decideCommand(denyInput).outcome, 'deny');

  // 3. Dynamic and outside scope
  const unknownScopeInput = makePolicyInput({
    analysis: makeMockAnalysis({ scope: 'unknown' }),
    yolo: { active: false, mode: 'workspace' },
  });
  assert.equal(decideCommand(unknownScopeInput).outcome, 'approval');

  const outsideScopeInput = makePolicyInput({
    analysis: makeMockAnalysis({ scope: 'outside' }),
    yolo: { active: false, mode: 'workspace' },
  });
  assert.equal(decideCommand(outsideScopeInput).outcome, 'approval');

  // 4. Parse invalid / unsupported
  const invalidInput = makePolicyInput({
    analysis: makeMockAnalysis({ parseStatus: 'invalid' }),
  });
  assert.equal(decideCommand(invalidInput).outcome, 'invalid');

  // 5. Expired rule
  const expiredInput = makePolicyInput({
    analysis,
    yolo: { active: false, mode: 'workspace' },
    rules: [
      {
        id: 'exp_1',
        effect: 'allow',
        predicate: {
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
        },
        scope: 'workspace',
        workspaceId: 'ws_1',
        expiresAt: '2020-01-01T00:00:00Z',
      },
    ],
  });
  assert.equal(decideCommand(expiredInput).outcome, 'approval');
});
