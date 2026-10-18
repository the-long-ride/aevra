import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDashboard, revokeActiveConnection } from './dashboard-service';

const requestJson = vi.fn();

vi.mock('../../services/api-client', () => ({
  requestJson: (path: string, init?: RequestInit) => requestJson(path, init),
}));

describe('dashboard-service', () => {
  beforeEach(() => {
    requestJson.mockReset();
  });
  it('loads runtime exposure and workspaces with the abort signal', async () => {
    const controller = new AbortController();
    requestJson.mockImplementation(async (path: string) => {
      if (path === '/api/dashboard/runtime') return { status: 'ready' };
      if (path === '/api/exposure/status') return { provider: 'local' };
      if (path === '/api/workspaces') return [{ id: 'w1' }];
      throw new Error(`unexpected path ${path}`);
    });

    const data = await loadDashboard(controller.signal);

    expect(data).toEqual({
      snapshot: { status: 'ready' },
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

  it('revokes durable connections by connection id', async () => {
    requestJson.mockResolvedValue(undefined);

    await revokeActiveConnection({ connectionId: 'conn/one', sessionId: 'session-unused' });

    expect(requestJson).toHaveBeenLastCalledWith('/api/connections/conn%2Fone/revoke', {
      method: 'POST',
      body: '{}',
    });
  });

  it('revokes session-backed connections by session id', async () => {
    requestJson.mockResolvedValue(undefined);

    await revokeActiveConnection({ sessionId: 'session/one' });

    expect(requestJson).toHaveBeenLastCalledWith('/api/sessions/session%2Fone/revoke', {
      method: 'POST',
      body: '{}',
    });
  });

  it('falls back to the row id for session-backed connections', async () => {
    requestJson.mockResolvedValue(undefined);

    await revokeActiveConnection({ id: 'row/one' });

    expect(requestJson).toHaveBeenLastCalledWith('/api/sessions/row%2Fone/revoke', {
      method: 'POST',
      body: '{}',
    });
  });

  it('rejects connections without a revocable identifier', async () => {
    await expect(revokeActiveConnection({})).rejects.toThrow(
      'Connection has no revocable session identifier.',
    );
  });
});
