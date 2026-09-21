import { expect, test } from 'vitest';
import { actionsForApproval } from './request-actions.js';

function labels(capability: string, risk = 'MEDIUM') {
  return actionsForApproval({
    id: 'a1',
    state: 'PENDING',
    actor: 'oauth:ChatGPT',
    risk,
    sessionId: 's1',
    workspaceId: 'w1',
    operation: { family: 'domain:registry.npmjs.org', capability },
  } as any).map((action) => action.label);
}

test('network approvals can be remembered for session workspace or global scope', () => {
  expect(labels('network')).toEqual([
    'Deny',
    'Allow',
    'Allow this session',
    'Always in workspace',
    'Always globally',
  ]);
});

test('critical approvals remain one-time only even for persistable capabilities', () => {
  expect(labels('network', 'CRITICAL')).toEqual(['Deny', 'Allow']);
});
