import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchToolSwitches, saveToolSwitches } from './tool-switch-service';

afterEach(() => vi.unstubAllGlobals());

function stub() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ tools: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('tool-switch-service', () => {
  it('fetches the listing', async () => {
    const fetchMock = stub();
    await expect(fetchToolSwitches()).resolves.toEqual({ tools: [] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tool-switches');
  });

  it('PUTs the disabled names', async () => {
    const fetchMock = stub();
    await saveToolSwitches(['git_status']);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ disabled: ['git_status'] }));
  });
});
