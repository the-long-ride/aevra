import { describe, expect, it, vi } from 'vitest';
import {
  approveRequest,
  decideOauth,
  denyRequest,
  enableYoloRequest,
  loadRequests,
} from './requests-service';

const requestJson = vi.fn();

vi.mock('../../services/api-client', () => ({
  requestJson: (path: string, init?: RequestInit) => requestJson(path, init),
}));

describe('requests-service', () => {
  it('loads approvals oauth requests and workspaces together', async () => {
    requestJson.mockImplementation(async (path: string) => {
      if (path === '/api/approvals') return [{ id: 'a1' }];
      if (path === '/api/oauth/requests') return [{ id: 'o1' }];
      if (path === '/api/workspaces') return [{ id: 'w1' }];
      throw new Error(`unexpected path ${path}`);
    });

    await expect(loadRequests()).resolves.toEqual({
      approvals: [{ id: 'a1' }],
      oauth: [{ id: 'o1' }],
      workspaces: [{ id: 'w1' }],
    });
  });

  it('approves with the chosen scope and URL-encodes the approval id', async () => {
    requestJson.mockResolvedValue(undefined);

    await approveRequest('needs/encoding', 'once');

    const [path, init] = requestJson.mock.calls[0];
    expect(path).toBe('/api/approvals/needs%2Fencoding/approve');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ scope: 'once' });
  });

  it('enables YOLO and denies with empty JSON bodies', async () => {
    requestJson.mockResolvedValue(undefined);

    await enableYoloRequest('a1');
    await denyRequest('a1');

    expect(requestJson.mock.calls[0]).toEqual([
      '/api/approvals/a1/yolo',
      { method: 'POST', body: '{}' },
    ]);
    expect(requestJson.mock.calls[1]).toEqual([
      '/api/approvals/a1/deny',
      { method: 'POST', body: '{}' },
    ]);
  });

  it('routes OAuth decisions to approve or deny endpoints', async () => {
    requestJson.mockResolvedValue(undefined);

    await decideOauth('o1', true);
    await decideOauth('o1', false);

    expect(requestJson.mock.calls[0][0]).toBe('/api/oauth/requests/o1/approve');
    expect(requestJson.mock.calls[1][0]).toBe('/api/oauth/requests/o1/deny');
    for (const call of requestJson.mock.calls) {
      expect(call[1].method).toBe('POST');
      expect(call[1].body).toBe('{}');
    }
  });
});
