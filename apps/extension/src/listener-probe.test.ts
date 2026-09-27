import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeListener, probeUrl } from './listener-probe';

afterEach(() => vi.unstubAllGlobals());

describe('probeUrl', () => {
  it('asks the same host and port over plain http', () => {
    expect(probeUrl('ws://127.0.0.1:47833')).toBe('http://127.0.0.1:47833/');
    expect(probeUrl('wss://127.0.0.1:47833/')).toBe('https://127.0.0.1:47833/');
  });
});

describe('probeListener', () => {
  it('reports a listener that answers at all as up', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 426 }));
    vi.stubGlobal('fetch', fetch);
    await expect(probeListener('ws://127.0.0.1:47833')).resolves.toBe('up');
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:47833/',
      expect.objectContaining({ cache: 'no-store', credentials: 'omit' }),
    );
  });

  it('reports an explicit refused connection as down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new TypeError('Failed to fetch'), { cause: { code: 'ECONNREFUSED' } });
      }),
    );
    await expect(probeListener('ws://127.0.0.1:47833')).resolves.toBe('down');
  });

  it('treats a generic fetch TypeError as ambiguous so the socket is tried', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(probeListener('ws://127.0.0.1:47833')).resolves.toBe('unknown');
  });

  // An Aevra build from before the probe handler accepts the connection but
  // never answers plain HTTP. That must still connect, not wait forever.
  it('treats a probe that times out as unknown, so the socket is still tried', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('signal timed out', 'TimeoutError');
      }),
    );
    await expect(probeListener('ws://127.0.0.1:47833')).resolves.toBe('unknown');
  });

  it('treats an unparseable url as unknown rather than throwing', async () => {
    await expect(probeListener('not a url')).resolves.toBe('unknown');
  });
});
