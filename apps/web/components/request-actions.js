const COMMAND_ACTIONS = [
  { id: 'deny', label: 'Deny', scope: null },
  { id: 'approve-once', label: 'Run once', scope: 'once' },
  {
    id: 'approve-session',
    label: 'Allow this session',
    scope: 'session',
  },
  {
    id: 'approve-workspace',
    label: 'Always in workspace',
    scope: 'workspace',
  },
  { id: 'approve-global', label: 'Always globally', scope: 'global' },
];

export function approvalActions({ risk, command }) {
  if (!command || risk === 'CRITICAL') {
    return COMMAND_ACTIONS.slice(0, 2);
  }
  return COMMAND_ACTIONS;
}
