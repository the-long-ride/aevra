import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestJson, requestText } from './api-client';

function jsonResponse(body: unknown, status = 200, contentType = 'application/json') {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': contentType }),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestJson', () => {
  it('sends no-store and json headers and parses JSON bodies', async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => jsonResponse({ value: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestJson('/api/x', { method: 'POST', body: '{}' })).resolves.toEqual({
      value: 1,
    });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/x');
    expect(init?.cache).toBe('no-store');
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('keeps explicit cache settings and merges caller headers', async () => {
    const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => jsonResponse('text'));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson('/api/x', {
      cache: 'default',
      headers: { authorization: 'Bearer token' },
    });
    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe('default');
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization).toBe(
      'Bearer token',
    );
  });

  it('returns plain text when the response is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse('plain', 200, 'text/plain')),
    );
    await expect(requestJson('/api/x')).resolves.toBe('plain');
  });

  it('prefers nested error messages then top-level fields then the status fallback', async () => {
    const cases: Array<[unknown, string]> = [
      [{ error: { message: 'nested message' } }, 'nested message'],
      [{ error: 'string error' }, 'string error'],
      [{ message: 'top level' }, 'top level'],
      ['not-json-object', 'HTTP 503'],
    ];
    for (const [body, expected] of cases) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(body, 503)),
      );
      await expect(requestJson('/api/x')).rejects.toThrow(expected);
    }
  });

  it('treats null JSON payloads as an empty error record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(null, 500)),
    );
    await expect(requestJson('/api/x')).rejects.toThrow('HTTP 500');
  });

  it('does not throw for non-ok responses without content type when body is empty text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse('', 404, '')),
    );
    // Empty text body: value stays a string, so the message falls back to the status.
    await expect(requestJson('/api/x')).rejects.toThrow('HTTP 404');
  });
});

describe('requestText', () => {
  it('returns response text on success without forcing headers', async () => {
    const fetchMock = vi.fn(
      async (_path: string, init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          text: async () => 'raw-body',
        }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestText('/api/export')).resolves.toBe('raw-body');
    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe('no-store');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });

  it('throws the HTTP status for failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })),
    );
    await expect(requestText('/api/export')).rejects.toThrow('HTTP 500');
  });
});
