import type { Page } from '@playwright/test';

export const ADMIN_SURFACES = [{ name: 'React', path: '/' }] as const;

interface FixtureOptions {
  onboardingCompleted?: boolean;
  approvals?: unknown[];
  oauth?: unknown[];
  permissions?: unknown[];
  sessions?: unknown[];
  adminSessions?: unknown[];
  processes?: unknown[];
  changes?: unknown[];
  mounts?: unknown[];
}

function dashboardSnapshot() {
  return {
    status: { version: '0.5.0' },
    uptimeSeconds: 120,
    pending: { total: 0 },
    stats: {
      sessions: 1,
      workspaceLeases: 1,
      processes: 1,
      openChanges: 1,
      toolCalls: 4,
      avgToolLatencyMs: 12,
      connectors: 1,
    },
    metrics: [{ tool: 'file_read', calls: 4, avgMs: 12, totalMs: 48 }],
    activeConnections: [
      {
        client: 'ChatGPT',
        authType: 'OAuth',
        workspace: 'Aevra',
        status: 'active',
        capabilities: ['files.read'],
        lastActivityAt: '2026-08-19T00:00:00Z',
      },
    ],
    connectors: [
      {
        id: 'connector-1',
        name: 'Static client',
        createdAt: '2026-08-19T00:00:00Z',
        lastUsedAt: '2026-08-19T00:00:00Z',
      },
    ],
  };
}

export async function installAdminApi(page: Page, options: FixtureOptions = {}) {
  const completed = options.onboardingCompleted ?? false;
  const routes = new Map<string, unknown>([
    [
      '/api/status',
      {
        version: '0.5.0',
        core: 'running',
        worker: 'ready',
        mcp: 'ready',
        tunnel: 'configured',
        tunnelReachable: true,
        safeMode: false,
      },
    ],
    ['/api/approvals', options.approvals ?? []],
    ['/api/oauth/requests', options.oauth ?? []],
    [
      '/api/onboarding',
      {
        completed,
        completedSections: completed
          ? ['remote-access', 'connect-ai', 'workspace', 'try-aevra']
          : [],
      },
    ],
    [
      '/api/cloudflare/status',
      {
        found: true,
        authenticated: true,
        hostname: 'aevra.example.com',
        tunnelId: 'tunnel-1',
        ownership: 'managed',
      },
    ],
    ['/api/workspaces', [{ id: 'ws-1', name: 'Aevra', hostRoot: '/repo' }]],
    ['/api/workspaces/ws-1/mounts', options.mounts ?? []],
    ['/api/dashboard/runtime', dashboardSnapshot()],
    ['/api/permissions', options.permissions ?? []],
    ['/api/admin-sessions', options.adminSessions ?? []],
    ['/api/sessions', options.sessions ?? []],
    ['/api/processes', options.processes ?? []],
    ['/api/changes', options.changes ?? []],
    ['/api/audit/verify', { valid: true }],
    ['/api/audit/export?format=json', []],
    ['/api/settings', {}],
    ['/api/policy/command-families', {}],
    ['/api/policy/network-rules', []],
    [
      '/api/execution-settings',
      { sandboxBackend: 'auto', cachePolicy: 'workspace', workspaceDrainMs: 60000 },
    ],
    ['/api/environment-profiles', []],
    ['/api/secret-references', []],
    [
      '/api/guide',
      [
        { slug: 'quick-start', title: 'Quick Start', file: '00-quick-start.md' },
        {
          slug: 'safe-command-matchers',
          title: 'Safe Command Matchers',
          file: '16-safe-command-matchers.md',
        },
      ],
    ],
  ]);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${url.pathname}${url.search}`;
    if (request.method() !== 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          result: { hostname: 'aevra.example.com' },
          token: 'secret-once',
        }),
      });
      return;
    }

    const value = routes.get(key);
    await route.fulfill({
      status: value === undefined ? 404 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        value ?? { error: { message: `Unmocked GET ${key}` } },
      ),
    });
  });
}
