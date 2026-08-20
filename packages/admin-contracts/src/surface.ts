export const ADMIN_SURFACE = {
  navigation: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'workspaces', label: 'Workspaces' },
    { id: 'permissions', label: 'Permissions' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'processes', label: 'Processes' },
    { id: 'changes', label: 'Changes' },
    { id: 'audit', label: 'Audit' },
    { id: 'settings', label: 'Settings' },
    { id: 'guide', label: 'Guide' },
  ],
  dashboardSections: [
    'onboarding',
    'runtime-overview',
    'live-mcp-activity',
    'active-connections',
    'tool-activity',
    'connections',
    'recent-activity',
  ],
  onboarding: {
    beforeCompletion: [
      'remote-access',
      'connect-ai',
      'workspace',
      'try-aevra',
      'finish-onboarding',
    ],
    completedPosition: 'bottom',
  },
  approvalScopes: ['once', 'session', 'workspace', 'global'],
  actions: {
    requests: ['deny', 'approve-once', 'approve-session', 'approve-workspace', 'approve-global'],
    permissions: [
      'add',
      'revoke',
      'filter-effect',
      'filter-capability',
      'filter-scope',
      'filter-actor',
    ],
    workspaces: ['add', 'details', 'remove', 'add-mount', 'remove-mount', 'save-admission'],
    sessions: ['switch-workspace', 'revoke', 'revoke-all-others'],
    processes: ['stop', 'restart', 'forget'],
    changes: ['rename', 'commit', 'rollback'],
    audit: ['export-json', 'export-jsonl', 'clear'],
    settings: [
      'save-remote-access',
      'test-remote-access',
      'save-access-mode',
      'save-execution',
      'save-command-family',
      'remove-command-family',
      'add-network-rule',
      'remove-network-rule',
      'create-environment-profile',
      'store-secret',
      'remove-secret',
    ],
    guide: ['select-chapter', 'copy-matcher', 'copy-all-matchers'],
    connections: ['create-connector', 'revoke-connector'],
    remoteAccess: ['authenticate', 'test-endpoint', 'save', 'copy-endpoint'],
  },
} as const;

export type AdminPageId = (typeof ADMIN_SURFACE.navigation)[number]['id'];
export type ApprovalScope = (typeof ADMIN_SURFACE.approvalScopes)[number];
export type DashboardSectionId = (typeof ADMIN_SURFACE.dashboardSections)[number];
export type OnboardingSectionId = (typeof ADMIN_SURFACE.onboarding.beforeCompletion)[number];

export function surfaceId(category: string, id: string): string {
  return `${category}:${id}`;
}
