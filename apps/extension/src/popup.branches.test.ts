import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stored: Record<string, unknown> = {};
const sentMessages: unknown[] = [];
let statusReply: (() => unknown) | null;

const CORE = `
  <div id="status-chip" data-state="off"><span id="status-text"></span></div>
  <span id="connection-desc"></span>
  <input type="checkbox" id="connection-toggle" checked />
  <input type="text" id="profile-name" />
  <span id="pairing-info"></span>
`;

const MODAL = `
  <button type="button" id="open-pair-modal">Pair</button>
  <div id="pair-modal" hidden>
    <button type="button" id="pair-modal-close">x</button>
    <form id="pair-form">
      <input id="pair-code" />
      <input id="pair-port" value="47831" />
      <p id="pair-status"></p>
      <button type="submit" id="pair-modal-submit">Pair</button>
    </form>
  </div>
`;

function text(id: string): string | null {
  return document.getElementById(id)!.textContent;
}

function pairSaved() {
  stored.token = 'saved-token';
  stored.wsUrl = 'ws://127.0.0.1:47833';
}

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(stored)) delete stored[key];
  sentMessages.length = 0;
  statusReply = () => ({ connected: true, state: 'connected' });
  document.body.innerHTML = CORE;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: string[], callback?: (result: Record<string, unknown>) => void) => {
          const result: Record<string, unknown> = {};
          for (const key of keys) if (key in stored) result[key] = stored[key];
          callback?.(result);
          return Promise.resolve(result);
        },
        set: async (values: Record<string, unknown>) => {
          Object.assign(stored, values);
        },
      },
    },
    runtime: {
      id: 'mock-ext-id',
      lastError: null,
      sendMessage: (message: { type?: string }, callback?: (response?: unknown) => void) => {
        sentMessages.push(message);
        if (callback && message?.type === 'aevra:getStatus') callback(statusReply?.() as any);
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
  delete (globalThis as any).fetch;
  vi.useRealTimers();
});

describe('resolveAdminPort', () => {
  it('keeps a valid port and falls back to the default otherwise', async () => {
    const { resolveAdminPort } = await import('./popup.js');
    expect(resolveAdminPort('9443')).toBe(9443);
    expect(resolveAdminPort(undefined)).toBe(47831);
    expect(resolveAdminPort(null)).toBe(47831);
    expect(resolveAdminPort('0')).toBe(47831);
    expect(resolveAdminPort('65536')).toBe(47831);
    expect(resolveAdminPort('12.5')).toBe(47831);
  });
});

describe('executePairing', () => {
  it('sends an empty extension id when the runtime has none', async () => {
    stored.profileId = '11111111-1111-4111-8111-111111111111';
    delete (globalThis as any).chrome.runtime.id;
    const bodies: any[] = [];
    (globalThis as any).fetch = async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ token: 'issued', wsUrl: 'ws://x' }) };
    };
    const { executePairing } = await import('./popup.js');
    const result = await executePairing(' abc ');
    expect(bodies[0]).toMatchObject({ code: 'ABC', extensionId: '' });
    expect(result).toEqual({
      ok: true,
      message: 'Paired over https.',
      token: 'issued',
      wsUrl: 'ws://x',
    });
  });

  it('reports the HTTP status when a refusal has no readable body', async () => {
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });
    const { executePairing } = await import('./popup.js');
    await expect(executePairing('abc')).resolves.toEqual({
      ok: false,
      message: 'Pairing failed: 500',
    });
    expect(stored.token).toBeUndefined();
  });
});

describe('popup rendering with partial markup', () => {
  it('skips status rendering when the status elements are absent', async () => {
    document.body.innerHTML =
      '<input type="checkbox" id="connection-toggle" checked /><input id="profile-name" />';
    pairSaved();
    const { initPopup } = await import('./popup.js');
    expect(() => initPopup()).not.toThrow();
    const toggle = document.getElementById('connection-toggle') as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(sentMessages).toContainEqual({ type: 'aevra:disconnect' });
  });

  it('renders unpaired and paired states without an unpaired banner', async () => {
    const { initPopup } = await import('./popup.js');
    initPopup();
    expect(text('status-text')).toBe('Unpaired');

    vi.resetModules();
    document.body.innerHTML = CORE;
    pairSaved();
    const again = await import('./popup.js');
    again.initPopup();
    expect(text('status-text')).toBe('Connected');
    expect(text('pairing-info')).toBe('Pairing saved');
  });

  it('treats a status reply without a state as still connecting', async () => {
    pairSaved();
    statusReply = () => undefined;
    const { initPopup } = await import('./popup.js');
    initPopup();
    expect(text('status-text')).toBe('Connecting');
  });

  it('restarts the profile-name debounce on every keystroke', async () => {
    vi.useFakeTimers();
    const { initPopup } = await import('./popup.js');
    initPopup();
    const input = document.getElementById('profile-name') as HTMLInputElement;
    input.value = 'A';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(200);
    input.value = 'AB';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(200);
    expect(stored.profileName).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    expect(stored.profileName).toBe('AB');
  });
});

describe('pair modal with partial markup', () => {
  it('ignores open and close controls when the modal itself is missing', async () => {
    document.body.innerHTML =
      CORE + '<button id="open-pair-modal"></button><button id="pair-modal-close"></button>';
    const { initPopup } = await import('./popup.js');
    initPopup();
    document.getElementById('open-pair-modal')!.click();
    document.getElementById('pair-modal-close')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('pair-modal')).toBeNull();
  });

  it('opens and closes a modal that has no status line or submit button', async () => {
    document.body.innerHTML =
      CORE +
      '<button id="open-pair-modal"></button>' +
      '<div id="pair-modal" hidden><button id="pair-modal-close"></button></div>';
    const { initPopup } = await import('./popup.js');
    initPopup();
    const modal = document.getElementById('pair-modal')!;
    document.getElementById('open-pair-modal')!.click();
    expect(modal.hasAttribute('hidden')).toBe(false);
    document.getElementById('pair-modal-close')!.click();
    expect(modal.hasAttribute('hidden')).toBe(true);
  });

  it('does not submit when the form lacks its code input', async () => {
    document.body.innerHTML =
      CORE + '<div id="pair-modal"><form id="pair-form"><p id="pair-status"></p></form></div>';
    const fetchSpy = vi.fn();
    (globalThis as any).fetch = fetchSpy;
    const { initPopup } = await import('./popup.js');
    initPopup();
    document.getElementById('pair-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(text('pair-status')).toBe('');
  });

  it('pairs while the toggle is off and tolerates a failed follow-up status query', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = CORE + MODAL;
    stored.enabled = false;
    (globalThis as any).fetch = async () => ({
      ok: true,
      json: async () => ({ token: 'issued', wsUrl: 'ws://x' }),
    });
    const { initPopup } = await import('./popup.js');
    initPopup();

    (document.getElementById('pair-code') as HTMLInputElement).value = 'abcd';
    document.getElementById('pair-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(text('pair-status')).toBe('Paired over https.'));
    expect(text('status-text')).toBe('Off');

    (globalThis as any).chrome.runtime.lastError = { message: 'no receiver' };
    await vi.advanceTimersByTimeAsync(500);
    expect(document.getElementById('pair-modal')!.hasAttribute('hidden')).toBe(true);
    expect(text('status-text')).toBe('Off');
  });

  it('falls back to connecting when the post-pair status reply has no state', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = CORE + MODAL;
    statusReply = () => undefined;
    (globalThis as any).fetch = async () => ({
      ok: true,
      json: async () => ({ token: 'issued', wsUrl: 'ws://x' }),
    });
    const { initPopup } = await import('./popup.js');
    initPopup();

    (document.getElementById('pair-code') as HTMLInputElement).value = 'abcd';
    document.getElementById('pair-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(text('pair-status')).toBe('Paired over https.'));
    await vi.advanceTimersByTimeAsync(500);
    expect(text('status-text')).toBe('Connecting');
    expect(sentMessages).toContainEqual({ type: 'aevra:getStatus' });
  });
});
