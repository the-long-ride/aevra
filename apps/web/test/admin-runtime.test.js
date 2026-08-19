import { afterAll, expect, test, vi } from 'vitest';

const approval = {
  id: 'approval-1',
  state: 'PENDING',
  actor: 'ChatGPT',
  risk: 'MEDIUM',
  workspaceId: 'ws-1',
  operation: { family: 'git:status', capability: 'commands.run' },
  payload: { permissionMatcher: 'git:status' },
  presentation: {
    title: 'ChatGPT requests commands.run',
    action: 'Run command',
    target: 'git status',
  },
};

const routes = new Map([
  ['/api/status', { version: '0.5.0', core: 'running', worker: 'ready', mcp: 'ready', tunnel: 'configured', tunnelReachable: true, safeMode: false }],
  ['/api/approvals', [approval]],
  ['/api/oauth/requests', [{ id: 'oauth-1', clientId: 'client-1', clientName: 'Claude', pairingCode: '1234', requestedScopes: ['mcp'] }]],
  ['/api/onboarding', { completed: false, completedSections: [] }],
  ['/api/cloudflare/status', { found: true, authenticated: true, hostname: 'aevra.example.com', tunnelId: 'tunnel-1', ownership: 'managed' }],
  ['/api/workspaces', [{ id: 'ws-1', name: 'Aevra', hostRoot: '/repo', description: 'Primary' }]],
  ['/api/workspaces/ws-1/mounts', [{ id: 'mount-1', logicalPath: '/external/shared', hostRoot: '/opt/shared', capabilities: ['files.read'] }]],
  ['/api/workspaces/ws-1/admissions', []],
  ['/api/connectors', [{ id: 'connector-1', name: 'Static client' }]],
  ['/api/oauth/clients', []],
  ['/api/dashboard/runtime', {
    status: { version: '0.5.0' },
    uptimeSeconds: 120,
    pending: { total: 2 },
    stats: { sessions: 1, workspaceLeases: 1, processes: 1, openChanges: 1, toolCalls: 4, avgToolLatencyMs: 12, connectors: 1 },
    metrics: [{ tool: 'file_read', calls: 4, avgMs: 12, totalMs: 48 }],
    activeConnections: [{ client: 'ChatGPT', authType: 'OAuth', workspace: 'Aevra', status: 'active', capabilities: ['files.read'], lastActivityAt: '2026-08-19T00:00:00Z' }],
    connectors: [{ id: 'connector-1', name: 'Static client', createdAt: '2026-08-19T00:00:00Z', lastUsedAt: '2026-08-19T00:00:00Z' }],
  }],
  ['/api/permissions', [{ id: 'rule-1', effect: 'allow', capability: 'commands.run', scope: 'workspace', actor: 'ChatGPT', matcher: 'git:status' }]],
  ['/api/sessions', [{ id: 'session-1', actor: 'ChatGPT', activeLeaseId: 'lease-1', lease: { workspaceId: 'ws-1' } }]],
  ['/api/admin-sessions', [{ idHash: 'local-1', createdAt: '2026-08-19T00:00:00Z' }]],
  ['/api/processes', [{ id: 'process-1', workspace_id: 'ws-1', ownership: 'owned', lifecycle: 'running', created_at: '2026-08-19T00:00:00Z' }]],
  ['/api/changes', [{ id: 'change-1', name: 'Draft', state: 'OPEN', workspace_id: 'ws-1', updated_at: '2026-08-19T00:00:00Z' }]],
  ['/api/audit/verify', { valid: true }],
  ['/api/audit/export?format=json', [{ createdAt: '2026-08-19T00:00:00Z', event: { actor: 'ChatGPT', operation: 'commands.run', target: 'git status', result: 'ok' } }]],
  ['/api/settings', { auditRetentionDays: 30 }],
  ['/api/policy/command-families', { 'git:status': 'READ_ONLY' }],
  ['/api/policy/network-rules', [{ id: 'network-1', effect: 'allow', protocol: 'https', host: 'api.example.com', port: 443, workspaceId: 'ws-1' }]],
  ['/api/execution-settings', { sandboxBackend: 'auto', cachePolicy: 'workspace', workspaceDrainMs: 60000 }],
  ['/api/environment-profiles', [{ name: 'dev', vars: { NODE_ENV: 'development' }, secretRefs: {} }]],
  ['/api/secret-references', [{ ref: 'API_TOKEN' }]],
  ['/api/guide', [{ slug: 'quick-start', title: 'Quick Start', file: '00-quick-start.md' }, { slug: 'safe-command-matchers', title: 'Safe Command Matchers', file: '16-safe-command-matchers.md' }]],
]);

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function settle(cycles = 16) {
  for (let index = 0; index < cycles; index += 1) await Promise.resolve();
}

function nav(label) {
  const button = [...document.querySelectorAll('[data-nav-page]')].find(
    (node) => node.textContent === label,
  );
  expect(button).toBeTruthy();
  button.click();
}

function heading() {
  return document.querySelector('#page h2')?.textContent;
}

const fetchMock = vi.fn(async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = String(init.method ?? 'GET').toUpperCase();
  if (url.startsWith('/manual/')) {
    return new Response('# Manual\n\nLocal documentation.', {
      headers: { 'content-type': 'text/plain' },
    });
  }
  if (method !== 'GET') {
    if (url === '/api/connectors' && method === 'POST') return json({ token: 'secret-once' });
    return json({ ok: true, result: { hostname: 'aevra.example.com' } });
  }
  return routes.has(url)
    ? json(routes.get(url))
    : json({ error: { message: `Unmocked GET ${url}` } }, 404);
});

afterAll(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('modular vanilla runtime boots every admin page and executes primary controls', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('prompt', vi.fn(() => 'value'));
  vi.stubGlobal('alert', vi.fn());
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
  document.body.innerHTML = '<div id="app"></div>';

  await import('../main.js');
  await settle();
  expect(heading()).toBe('Dashboard');
  expect(document.querySelector('#app-version')?.textContent).toBe('v0.5.0');

  document.querySelector('#open-requests').click();
  await settle();
  expect(document.querySelector('[data-scope="global"]')).toBeTruthy();
  document.querySelector('[data-request-tab="history"]').click();
  document.querySelector('[data-request-tab="pending"]').click();

  nav('Workspaces');
  await settle();
  expect(heading()).toBe('Workspaces');
  document.querySelector('[data-table-action="details"]').click();
  await settle();
  expect(document.querySelector('#add-mount')).toBeTruthy();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

  nav('Permissions');
  await settle();
  expect(heading()).toBe('Permissions');
  document.querySelector('#add-permission-rules').click();
  const commands = [...document.querySelectorAll('input[name="capability"]')].find(
    (node) => node.value === 'commands.run',
  );
  commands.click();
  expect(document.querySelector('textarea[name="commandMatchers"]')).toBeTruthy();
  document.querySelector('[data-table-action="revoke"]').click();
  await settle();

  nav('Sessions');
  await settle();
  expect(heading()).toBe('Sessions');
  document.querySelector('[data-table-action="revoke"]').click();
  await settle();

  nav('Processes');
  await settle();
  expect(heading()).toBe('Processes');
  [...document.querySelectorAll('button')].find((node) => node.textContent === 'Stop').click();
  await settle();

  nav('Changes');
  await settle();
  expect(heading()).toBe('Changes');
  [...document.querySelectorAll('button')].find((node) => node.textContent === 'Rollback').click();
  await settle();

  nav('Audit');
  await settle();
  expect(heading()).toBe('Audit');
  document.querySelector('[data-audit-clear]')?.click();
  await settle();

  nav('Settings');
  await settle();
  expect(heading()).toBe('Settings');
  document.querySelector('#execution-settings').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await settle();

  nav('Guide');
  await settle();
  expect(heading()).toBe('Guide');
  [...document.querySelectorAll('button')]
    .find((node) => node.textContent === 'Safe Command Matchers')
    .click();
  await settle();
  document.querySelector('[data-copy-all-matchers]').click();

  nav('Dashboard');
  await settle();
  document.querySelector('#create-connector').click();
  const connectorForm = document.querySelector('#connector-form');
  connectorForm.querySelector('input[name="name"]').value = 'Parity client';
  connectorForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(document.body.textContent).toContain('secret-once');
});
