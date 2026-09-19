import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executePairing, resolveAdminPort } from './popup.js';

const stored: Record<string, unknown> = {};
const sentMessages: unknown[] = [];

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(stored)) delete stored[key];
  sentMessages.length = 0;

  (globalThis as any).chrome = {
    storage: {
      local: {
        set: async (values: Record<string, unknown>) => {
          Object.assign(stored, values);
        },
      },
    },
    runtime: {
      id: 'mock-ext-id',
      sendMessage: (message: unknown) => {
        sentMessages.push(message);
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
  delete (globalThis as any).fetch;
});

describe('popup pairing logic', () => {
  it('resolves custom admin ports correctly and falls back for invalid inputs', () => {
    expect(resolveAdminPort('9443')).toBe(9443);
    expect(resolveAdminPort(9443)).toBe(9443);
    expect(resolveAdminPort('')).toBe(47831);
    expect(resolveAdminPort('invalid')).toBe(47831);
    expect(resolveAdminPort('-5')).toBe(47831);
    expect(resolveAdminPort('999999')).toBe(47831);
  });

  it('submits pairing successfully and stores token over TLS', async () => {
    const requests: any[] = [];
    (globalThis as any).fetch = async (url: string, init: any) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        json: async () => ({ token: 'new-token', wsUrl: 'ws://127.0.0.1:47833' }),
      };
    };

    const result = await executePairing('abcd1234', '47831');

    expect(result.ok).toBe(true);
    expect(result.message).toBe('Paired over https.');
    expect(requests[0].url).toBe('https://127.0.0.1:47831/api/browser/pair');
    expect(requests[0].body).toEqual({ code: 'ABCD1234', extensionId: 'mock-ext-id' });
    expect(stored).toEqual({ token: 'new-token', wsUrl: 'ws://127.0.0.1:47833' });
    expect(sentMessages).toContainEqual({ type: 'aevra:paired' });
  });

  it('falls back to HTTP when HTTPS transport fails', async () => {
    const urls: string[] = [];
    (globalThis as any).fetch = async (url: string) => {
      urls.push(url);
      if (url.startsWith('https:')) throw new TypeError('connection failed');
      return {
        ok: true,
        json: async () => ({ token: 'fallback-token', wsUrl: 'ws://127.0.0.1:47833' }),
      };
    };

    const result = await executePairing('TESTCODE', 47831);

    expect(urls).toEqual([
      'https://127.0.0.1:47831/api/browser/pair',
      'http://127.0.0.1:47831/api/browser/pair',
    ]);
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Paired over http.');
  });

  it('reports certificate/unreachable error when neither TLS nor HTTP connect', async () => {
    (globalThis as any).fetch = async () => {
      throw new TypeError('connection refused');
    };

    const result = await executePairing('TESTCODE', 47831);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Pairing failed: Aevra is not reachable');
  });

  it('reports server error code when pairing is refused by daemon', async () => {
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'PAIRING_CODE_EXPIRED' } }),
    });

    const result = await executePairing('EXPIRED1', 47831);

    expect(result.ok).toBe(false);
    expect(result.message).toBe('Pairing failed: PAIRING_CODE_EXPIRED');
  });

  it('handles server errors without payload code', async () => {
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await executePairing('ERRORCODE', 47831);

    expect(result.ok).toBe(false);
    expect(result.message).toBe('Pairing failed: 500');
  });
});
