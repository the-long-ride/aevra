import type { ApprovalItem, ApprovalScope } from '@aevra/admin-contracts';

export interface ApprovalAction {
  id: string;
  label: string;
  scope: ApprovalScope | null;
}

const PERSISTABLE_CAPABILITIES = new Set([
  'commands.run',
  'network',
  'browser.control',
  'desktop.control',
]);

export function actionsForApproval(item: ApprovalItem): ApprovalAction[] {
  const deny: ApprovalAction = { id: 'deny', label: 'Deny', scope: null };
  const once: ApprovalAction = {
    id: 'approve-once',
    label: item.operation.capability === 'commands.run' ? 'Run once' : 'Allow',
    scope: 'once',
  };
  if (item.risk === 'CRITICAL') return [deny, once];
  if (!PERSISTABLE_CAPABILITIES.has(item.operation.capability)) return [deny, once];
  return [
    deny,
    once,
    { id: 'approve-session', label: 'Allow this session', scope: 'session' },
    {
      id: 'approve-workspace',
      label: 'Always in workspace',
      scope: 'workspace',
    },
    { id: 'approve-global', label: 'Always globally', scope: 'global' },
  ];
}
