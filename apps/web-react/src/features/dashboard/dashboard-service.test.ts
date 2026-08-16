import { describe, expect, it, vi } from 'vitest';
import { completeOnboarding, loadDashboard, registerWorkspace } from './dashboard-service';

const requestJson = vi.fn();

vi.mock('../../services/api-client', () => ({
  requestJson: (path: string, init?: RequestInit) => requestJson(path, init),
}));

describe('dashboard-service', () => {
  it('loads runtime onboarding exposure and workspaces with the abort signal', async () => {
    const controller = new AbortController();
    requestJson.mockImplementation(async (path: string) => {
      if (path === '/api/dashboard/runtime') return { status: 'ready' };
      if (path === '/api/onboarding') return { completedSections: [] };
      if (path === '/api/exposure/status') return { provider: 'local' };
      if (path === '/api/workspaces') return [{ id: 'w1' }];
      throw new Error(`unexpected path ${path}`);
    });

    const data = await loadDashboard(controller.signal);

    expect(data).toEqual({
      snapshot: { status: 'ready' },
      onboarding: { completedSections: [] },
      exposure: { provider: 'local' },
      workspaces: [{ id: 'w1' }],
    });
    for (const call of requestJson.mock.calls) {
      expect(call[1].signal).toBe(controller.signal);
    }
  });

  it('omits options entirely when no signal is provided', async () => {
    requestJson.mockResolvedValue(undefined);
    await loadDashboard();
    for (const [, init] of requestJson.mock.calls) {
      expect(init).toEqual({});
    }
  });

  it('completes every onboarding section through PATCH', async () => {
    requestJson.mockResolvedValue(undefined);
    await completeOnboarding();

    expect(requestJson.mock.calls[0][0]).toBe('/api/onboarding');
    expect(requestJson.mock.calls[0][1]).toEqual({
      method: 'PATCH',
      body: JSON.stringify({
        completed: true,
        completedSections: ['remote-access', 'connect-ai', 'workspace', 'try-aevra', 'explore'],
      }),
    });
  });

  it('registers a workspace from form fields as JSON', async () => {
    requestJson.mockResolvedValue(undefined);
    const form = new FormData();
    form.set('name', 'main');
    form.set('hostRoot', 'F:/ws/main');

    await registerWorkspace(form);

    expect(requestJson.mock.calls[0]).toEqual([
      '/api/workspaces',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'main', hostRoot: 'F:/ws/main' }),
      },
    ]);
  });
});
