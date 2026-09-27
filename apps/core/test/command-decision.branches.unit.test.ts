import assert from 'node:assert/strict';
import test from 'node:test';
import { decideCommand } from '../src/policy/command-decision.js';

function node(overrides: Record<string, unknown> = {}): any {
  return {
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
    ...overrides,
  };
}

function analysis(overrides: Record<string, unknown> = {}): any {
  return {
    version: 1,
    requestFingerprint: 'req_1',
    context: { actor: 'operator', sessionId: 'ses_1', workspaceId: 'ws_1', backendId: 'host' },
    parseStatus: 'complete',
    scope: 'inside',
    nodes: [node()],
    edges: [],
    reasons: [],
    evidenceFingerprint: 'evi_1',
    ...overrides,
  };
}

function predicate(overrides: Record<string, unknown> = {}): any {
  return {
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
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}): any {
  return {
    analysis: analysis(),
    rules: [],
    authority: { valid: true, commandCapability: true, reasons: [] },
    network: { outcome: 'allow', reasons: [] },
    yolo: { active: false, mode: 'workspace' },
    criticalAlwaysConfirm: false,
    scriptTrust: 'trusted',
    ...overrides,
  };
}

const allowRule = (p: any, extra: Record<string, unknown> = {}) => ({ id: 'rule_1', effect: 'allow', scope: 'global', predicate: p, ...extra });

/** Outcome of an otherwise-ordinary command with one allow rule and a given node. */
function outcomeFor(p: any, n: any = node(), extra: Record<string, unknown> = {}) {
  const decision = decideCommand(input({ analysis: analysis({ nodes: [n] }), rules: [allowRule(p, extra)] }));
  return decision.outcome === 'allow' ? 'allow' : (decision as any).reasons[0].code;
}

test('an applicable matching allow rule allows and reports its id', () => {
  const decision = decideCommand(input({ rules: [allowRule(predicate())] }));
  assert.deepEqual(decision, { outcome: 'allow', analysis: decision.analysis, ruleIds: ['rule_1'] });
});

test('rule predicates reject mismatched application, operation, script, and modifiers', () => {
  assert.equal(outcomeFor(predicate({ version: 1 })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(predicate({ application: 'npm' })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(predicate({ operation: ['status', 'extra'] })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(predicate({ operation: ['log'] })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(predicate({ operation: ['*'] })), 'allow');
  assert.equal(outcomeFor(predicate({ operation: [] })), 'allow');
  assert.equal(outcomeFor(predicate({ scriptName: 'build' }), node({ scriptName: 'test' })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(predicate({ scriptName: 'build' }), node({ scriptName: 'build' })), 'allow');
  assert.equal(outcomeFor(predicate(), node({ modifiers: ['env'] })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(predicate({ allowedModifiers: ['env'] }), node({ modifiers: ['env'] })), 'allow');
  assert.equal(outcomeFor(predicate({ allowedModifiers: ['*'] }), node({ modifiers: ['redirect'] })), 'allow');
});

test('rule predicates check options by name, wildcard, and allowed values', () => {
  const withOption = (option: Record<string, unknown>) => node({ options: [option] });
  assert.equal(outcomeFor(predicate(), withOption({ name: '--short' })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(predicate({ allowedOptions: [{ name: '--short' }] }), withOption({ name: '--short' })), 'allow');
  assert.equal(outcomeFor(predicate({ allowedOptions: [{ name: '*' }] }), withOption({ name: '--any' })), 'allow');
  const valued = predicate({ allowedOptions: [{ name: '--format', values: ['json'] }] });
  assert.equal(outcomeFor(valued, withOption({ name: '--format' })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(valued, withOption({ name: '--format', value: 'xml' })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(valued, withOption({ name: '--format', value: 'json' })), 'allow');
  const anyValue = predicate({ allowedOptions: [{ name: '--format', values: ['*'] }] });
  assert.equal(outcomeFor(anyValue, withOption({ name: '--format', value: 'xml' })), 'allow');
});

test('rule predicates check positional constraints, backends, and dialects', () => {
  const exact = (argv?: string[]) => predicate({ positionalConstraint: 'exact', exactArgv: argv });
  assert.equal(outcomeFor(exact(['git', 'status'])), 'allow');
  assert.equal(outcomeFor(exact(['git', 'log'])), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(exact(['git'])), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(predicate(), node({ targets: [{ scope: 'outside' }] })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(predicate(), node({ targets: [{ scope: 'inside' }] })), 'allow');
  assert.equal(outcomeFor(predicate({ backends: ['sandbox'] })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(predicate({ backends: ['*'] })), 'allow');
  assert.equal(outcomeFor(predicate({ dialects: ['bash'] })), 'NO_REMEMBERED_RULE');
});

test('rule predicates check executable, wrapper, script fingerprints, and target scope', () => {
  const exe = predicate({ executableFingerprint: 'exe sample' });
  assert.equal(outcomeFor(exe), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(exe, node({ executable: { fingerprint: 'other sample' } })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(exe, node({ executable: { fingerprint: 'exe sample' } })), 'allow');
  const wrapped = predicate({ wrapperFingerprints: ['wrap sample'] });
  assert.equal(outcomeFor(wrapped), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(wrapped, node({ wrappers: [{ identity: { fingerprint: 'wrap sample' } }] })), 'allow');
  const script = predicate({ scriptFingerprint: 'script sample' });
  assert.equal(outcomeFor(script), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(script, node({ scriptFingerprint: 'other' })), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(script, node({ scriptFingerprint: 'script sample' })), 'allow');
  assert.equal(outcomeFor(predicate(), node({ scope: 'outside' })), 'NO_REMEMBERED_RULE');
});

test('rule applicability honours expiry, session, workspace, and actor', () => {
  const p = predicate();
  assert.equal(outcomeFor(p, node(), { expiresAt: '2000-01-01T00:00:00.000Z' }), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(p, node(), { expiresAt: '2999-01-01T00:00:00.000Z' }), 'allow');
  assert.equal(outcomeFor(p, node(), { scope: 'session' }), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(p, node(), { scope: 'session', sessionId: 'ses_2' }), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(p, node(), { scope: 'session', sessionId: 'ses_1' }), 'allow');
  assert.equal(outcomeFor(p, node(), { scope: 'workspace' }), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(p, node(), { scope: 'workspace', workspaceId: 'ws_2' }), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(p, node(), { scope: 'workspace', workspaceId: 'ws_1' }), 'allow');
  assert.equal(outcomeFor(p, node(), { actor: 'someone' }), 'NO_REMEMBERED_RULE');
  assert.equal(outcomeFor(p, node(), { actor: 'operator' }), 'allow');
});

test('deny paths: invalid authority, invalid parse, legacy deny, typed deny, network deny', () => {
  const reasons = [{ code: 'AUTH', message: 'bad authority' }];
  assert.deepEqual((decideCommand(input({ authority: { valid: false, reasons } })) as any).reasons, reasons);
  assert.equal(decideCommand(input({ analysis: analysis({ parseStatus: 'invalid' }) })).outcome, 'invalid');
  const legacy = decideCommand(input({ selectedLegacyDecision: { outcome: 'deny', reason: 'legacy words' } }));
  assert.deepEqual((legacy as any).reasons, [{ code: 'SELECTED_DENY', message: 'legacy words' }]);
  const typed = decideCommand(input({ rules: [{ ...allowRule(predicate()), id: 'deny_1', effect: 'deny' }] }));
  assert.equal((typed as any).reasons[0].message, 'Command matched deny rule: deny_1');
  const net = [{ code: 'NET', message: 'network words' }];
  assert.deepEqual((decideCommand(input({ network: { outcome: 'deny', reasons: net } })) as any).reasons, net);
});

test('approval paths without YOLO: critical, partial syntax, scripts, network, empty nodes', () => {
  const code = (i: any) => (decideCommand(i) as any).reasons.at(-1).code;
  const critical = analysis({ nodes: [node({ risk: 'CRITICAL' })] });
  assert.equal(code(input({ analysis: critical })), 'CRITICAL_OPERATION');
  const exact = { ticketId: 't1', requestFingerprint: 'req_1', evidenceFingerprint: 'evi_1', consumed: false, authorityVerified: true };
  assert.deepEqual((decideCommand(input({ analysis: critical, exactApproval: exact })) as any).ruleIds, ['t1']);
  assert.deepEqual(
    (decideCommand(input({ analysis: critical, exactApproval: exact, yolo: { active: true, mode: 'workspace' } })) as any).ruleIds,
    ['t1'],
  );
  const unverified = { ...exact, authorityVerified: false };
  assert.equal(code(input({ analysis: critical, exactApproval: unverified })), 'CRITICAL_OPERATION');
  assert.equal(code(input({ analysis: analysis({ parseStatus: 'partial' }) })), 'UNSUPPORTED_SYNTAX');
  assert.equal(code(input({ scriptTrust: 'unapproved' })), 'SCRIPT_EVIDENCE_REQUIRED');
  assert.equal(code(input({ scriptTrust: 'changed' })), 'SCRIPT_CHANGED');
  const net = [{ code: 'NET_APPROVAL', message: 'network words' }];
  assert.equal(code(input({ network: { outcome: 'approval', reasons: net } })), 'NET_APPROVAL');
  assert.equal(decideCommand(input({ network: undefined, rules: [allowRule(predicate())] })).outcome, 'allow');
  const empty = decideCommand(input({ analysis: analysis({ nodes: [] }), rules: [allowRule(predicate())] }));
  assert.equal((empty as any).reasons[0].code, 'NO_REMEMBERED_RULE');
  assert.deepEqual((empty as any).suggestedRules, []);
});
