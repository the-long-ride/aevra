import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stored: Record<string, unknown> = {};
const messages: unknown[] = [];

function renderPage() {
  document.body.innerHTML =
    '<form id="pair"><input id="code" /><input id="port" value="47831" />' +
    '<button type="submit">Pair</button></form><p id="status"></p>';
}

async function submit(code: string) {
  (document.getElementById('code') as HTMLInputElement).value = code;
  document.getElementById('pair')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() =>
    expect(document.getElementById('status')!.textContent).not.toBe('Pairing…'),
  );
}

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(stored)) delete stored[key];
  messages.length = 0;
  renderPage();
  (globalThis as any).chrome = {
    runtime: {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      sendMessage: (message: unknown) => messages.push(message),
    },
    storage: {
      local: {
        set: async (values: Record<string, unknown>) => Object.assign(stored, values),
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
  delete (globalThis as any).fetch;
});

describe('options pairing form', () => {
  it('posts the code with this extension’s own id and stores the token', async () => {
    const requests: any[] = [];
    (globalThis as any).fetch = async (url: string, init: any) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ token: 'issued', wsUrl: 'ws://127.0.0.1:47833' }) };
    };
    await import('./options');
    await submit('abcdefgh');

    expect(requests[0].url).toContain('/api/browser/pair');
    expect(requests[0].body).toEqual({
      code: 'ABCDEFGH',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    });
    expect(stored).toEqual({ token: 'issued', wsUrl: 'ws://127.0.0.1:47833' });
    expect(document.getElementById('status')!.textContent).toBe('Paired over https.');
  });

  it('tries TLS first, because admin listens TLS-only once a certificate exists', async () => {
    const urls: string[] = [];
    (globalThis as any).fetch = async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => ({ token: 'issued', wsUrl: 'ws://x' }) };
    };
    await import('./options');
    await submit('abcdefgh');
    expect(urls).toEqual(['https://127.0.0.1:47831/api/browser/pair']);
  });

  it('falls back to http only when TLS never reached a server', async () => {
    const urls: string[] = [];
    (globalThis as any).fetch = async (url: string) => {
      urls.push(url);
      if (url.startsWith('https:')) throw new TypeError('failed to fetch');
      return { ok: true, json: async () => ({ token: 'issued', wsUrl: 'ws://x' }) };
    };
    await import('./options');
    await submit('abcdefgh');
    expect(urls).toEqual([
      'https://127.0.0.1:47831/api/browser/pair',
      'http://127.0.0.1:47831/api/browser/pair',
    ]);
    expect(document.getElementById('status')!.textContent).toBe('Paired over http.');
  });

  it('never downgrades after a TLS response, however that response refused', async () => {
    const urls: string[] = [];
    (globalThis as any).fetch = async (url: string) => {
      urls.push(url);
      return { ok: false, status: 403, json: async () => ({ error: { code: 'FORBIDDEN' } }) };
    };
    await import('./options');
    await submit('abcdefgh');
    expect(urls).toEqual(['https://127.0.0.1:47831/api/browser/pair']);
    expect(stored).toEqual({});
  });

  it('uses the operator’s admin port', async () => {
    (document.getElementById('port') as HTMLInputElement).value = '9443';
    const urls: string[] = [];
    (globalThis as any).fetch = async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => ({ token: 'issued', wsUrl: 'ws://x' }) };
    };
    await import('./options');
    await submit('abcdefgh');
    expect(urls[0]).toBe('https://127.0.0.1:9443/api/browser/pair');
  });

  it('tells the service worker to connect once pairing succeeds', async () => {
    (globalThis as any).fetch = async () => ({
      ok: true,
      json: async () => ({ token: 'issued', wsUrl: 'ws://x' }),
    });
    await import('./options');
    await submit('abcdefgh');
    expect(messages).toEqual([{ type: 'aevra:paired' }]);
  });

  it('never renders the token it received', async () => {
    (globalThis as any).fetch = async () => ({
      ok: true,
      json: async () => ({ token: 'must-not-be-rendered', wsUrl: 'ws://x' }),
    });
    await import('./options');
    await submit('abcdefgh');
    expect(document.body.textContent).not.toContain('must-not-be-rendered');
  });

  it('shows the server error code and stores nothing on refusal', async () => {
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'PAIRING_CODE_INVALID' } }),
    });
    await import('./options');
    await submit('wrongcod');
    expect(document.getElementById('status')!.textContent).toContain('PAIRING_CODE_INVALID');
    expect(stored).toEqual({});
  });

  it('names the certificate as the likely cause when neither scheme connects', async () => {
    (globalThis as any).fetch = async () => {
      throw new Error('connection refused');
    };
    await import('./options');
    await submit('abcdefgh');
    const text = document.getElementById('status')!.textContent ?? '';
    expect(text).toMatch(/not reachable/i);
    expect(text).toMatch(/certificate/i);
    expect(stored).toEqual({});
  });
});
