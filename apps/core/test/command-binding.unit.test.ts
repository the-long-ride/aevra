import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindCommandApproval,
  clearExpiredBindings,
  consumeCommandApproval,
  getCommandApprovalBinding,
  validateCommandApprovalBinding,
} from '../src/approvals/command-binding.js';

test('command approval binding lifecycle and error branches', () => {
  const analysis = {
    requestFingerprint: 'req_123',
    evidenceFingerprint: 'evi_456',
  } as any;

  // 1. Not found
  const notFound = consumeCommandApproval('ticket_nonexistent', analysis);
  assert.equal(notFound.ok, false);
  assert.equal(notFound.reason, 'Binding not found for ticket');
  assert.equal(getCommandApprovalBinding('ticket_nonexistent'), null);

  // 2. Bind and retrieve
  const binding = bindCommandApproval('ticket_1', analysis, 'sess_1', 'ws_1');
  assert.equal(binding.ticketId, 'ticket_1');
  assert.equal(binding.sessionId, 'sess_1');
  assert.equal(binding.workspaceId, 'ws_1');
  assert.equal(binding.consumed, false);
  assert.equal(getCommandApprovalBinding('ticket_1')?.ticketId, 'ticket_1');

  // 3. Evidence or request fingerprint mismatch
  const changedReq = {
    requestFingerprint: 'req_changed',
    evidenceFingerprint: 'evi_456',
  } as any;
  const mismatch1 = consumeCommandApproval('ticket_1', changedReq);
  assert.equal(mismatch1.ok, false);
  assert.equal(mismatch1.reason, 'Evidence or context changed since approval');

  const changedEvi = {
    requestFingerprint: 'req_123',
    evidenceFingerprint: 'evi_changed',
  } as any;
  const mismatch2 = consumeCommandApproval('ticket_1', changedEvi);
  assert.equal(mismatch2.ok, false);
  assert.equal(mismatch2.reason, 'Evidence or context changed since approval');

  // 4. Successful consume
  const success = consumeCommandApproval('ticket_1', analysis);
  assert.equal(success.ok, true);
  assert.equal(getCommandApprovalBinding('ticket_1'), null);

  // 5. Consumed bindings are removed immediately
  const alreadyConsumed = consumeCommandApproval('ticket_1', analysis);
  assert.equal(alreadyConsumed.ok, false);
  assert.equal(alreadyConsumed.reason, 'Binding not found for ticket');

  // 6. clearExpiredBindings
  bindCommandApproval('ticket_old', analysis, 'sess_old', 'ws_old');
  const oldBinding = getCommandApprovalBinding('ticket_old');
  assert.ok(oldBinding);
  // simulate createdAt 1 hour ago
  oldBinding.createdAt = new Date(Date.now() - 3600 * 1000).toISOString();

  bindCommandApproval('ticket_fresh', analysis, 'sess_fresh', 'ws_fresh');

  clearExpiredBindings(1000); // 1 second max age
  assert.equal(getCommandApprovalBinding('ticket_old'), null);
  assert.ok(getCommandApprovalBinding('ticket_fresh'));

  // default maxAgeMs branch
  clearExpiredBindings();
});

test('command approval binding rejects canonical cwd or target identity changes', () => {
  const analysis: any = {
    requestFingerprint: 'req_canonical',
    evidenceFingerprint: 'evi_canonical',
    context: {
      rootsRevision: 'roots-1',
      backendRevision: 'backend-1',
      policyRevision: 'policy-1',
      environmentFingerprint: 'env-1',
      resolverGeneration: 'resolver-1',
    },
    scope: 'inside',
    parseStatus: 'complete',
    nodes: [
      {
        application: 'cp',
        argv: ['cp', 'a', 'b'],
        executable: { fingerprint: 'exe-1', canonicalPath: '/bin/cp' },
        wrappers: [],
        scriptFingerprint: null,
        risk: 'MEDIUM',
        scope: 'inside',
        canonicalCwdCandidates: ['/workspace/one'],
        targets: [
          {
            path: 'b',
            access: 'write',
            scope: 'inside',
            canonicalPath: '/workspace/one/b',
          },
        ],
      },
    ],
  };

  bindCommandApproval('ticket_canonical', analysis, 'sess', 'ws');
  const retargeted = structuredClone(analysis);
  retargeted.nodes[0].canonicalCwdCandidates = ['/workspace/two'];
  retargeted.nodes[0].targets[0].canonicalPath = '/workspace/two/b';
  assert.deepEqual(validateCommandApprovalBinding('ticket_canonical', retargeted), {
    ok: false,
    reason: 'Evidence or context changed since approval',
  });
  clearExpiredBindings(-1);
});
