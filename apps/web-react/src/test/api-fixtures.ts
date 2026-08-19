import { vi } from 'vitest';

export interface FixtureOptions {
  onboardingCompleted?: boolean;
  approvals?: unknown[];
  oauth?: unknown[];
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function installApiFixtures(options: FixtureOptions = {}) {
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
    [
      '/api/dashboard/runtime',
      {
        status: { version: '0.5.0' },
        uptimeSeconds: 100,
        pending: { total: 0 },
        stats: {
          sessions: 1,
          workspaceLeases: 1,
          processes: 0,
          openChanges: 0,
          toolCalls: 3,
          avgToolLatencyMs: 10,
          connectors: 1,
        },
        metrics: [{ tool: 'file_read', calls: 3, avgMs: 10, totalMs: 30 }],
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
      },
    ],
    ['/api/permissions', []],
    ['/api/admin-sessions', []],
    ['/api/sessions', []],
    ['/api/processes', []],
    ['/api/changes', []],
    ['/api/audit/verify', { valid: true }],
    ['/api/audit/export?format=json', []],
    ['/api/settings', {}],
    ['/api/policy/command-families', {}],
    ['/api/policy/network-rules', []],
    [
      '/api/execution-settings',
      {
        sandboxBackend: 'auto',
        cachePolicy: 'workspace',
        workspaceDrainMs: 60000,
      },
    ],
    ['/api/environment-profiles', []],
    ['/api/secret-references', []],
    [
      '/api/guide',
      [
        {
          slug: 'quick-start',
          title: 'Quick Start',
          file: '00-quick-start.md',
        },
        {
          slug: 'safe-command-matchers',
          title: 'Safe Command Matchers',
          file: '16-safe-command-matchers.md',
        },
      ],
    ],
  ]);

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.pathname + input.search
            : input.url;
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (url.startsWith('/manual/')) {
        return new Response('# Quick Start\n\nLocal manual.', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      }
      if (method !== 'GET') {
        return json({
          ok: true,
          result: { hostname: 'aevra.example.com' },
          token: 'secret-once',
        });
      }
      if (url.includes('/mounts')) return json([]);
      const value = routes.get(url);
      if (value !== undefined) return json(value);
      return json({ error: { message: `Unmocked ${method} ${url}` } }, 404);
    },
  );

  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('prompt', vi.fn(() => null));
  vi.stubGlobal('alert', vi.fn());
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(async () => undefined) },
  });
  return fetchMock;
}
