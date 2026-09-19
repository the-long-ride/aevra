import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stored: Record<string, unknown> = {};
const sentMessages: unknown[] = [];

function renderPopupDOM() {
  document.body.innerHTML = `
    <div class="header">
      <div class="brand-sub">Browser Profile</div>
      <div id="status-chip" data-state="off">
        <span id="status-text">Disconnected</span>
      </div>
    </div>
    <div id="unpaired-banner" hidden>
      <button type="button" id="banner-pair-btn">Pair now</button>
    </div>
    <div class="setting-card">
      <span id="connection-desc">Connection paused</span>
      <input type="checkbox" id="connection-toggle" checked />
    </div>
    <div class="field-group">
      <span id="save-status">Saved</span>
      <input type="text" id="profile-name" />
    </div>
    <div class="footer">
      <button type="button" id="open-pair-modal">Pair with Aevra</button>
      <span id="pairing-info"></span>
    </div>
  `;
}

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(stored)) delete stored[key];
  sentMessages.length = 0;
  renderPopupDOM();

  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: string[], callback: (result: Record<string, unknown>) => void) => {
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            if (key in stored) result[key] = stored[key];
          }
          callback(result);
        },
        set: async (values: Record<string, unknown>) => {
          Object.assign(stored, values);
        },
      },
    },
    runtime: {
      id: 'mock-ext-id',
      lastError: null,
      sendMessage: (message: unknown, callback?: (response?: unknown) => void) => {
        sentMessages.push(message);
        if (callback) {
          if ((message as { type?: string })?.type === 'aevra:getStatus') {
            callback({ connected: true });
          } else {
            callback();
          }
        }
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
  delete (globalThis as any).fetch;
  vi.useRealTimers();
});

describe('popup extension UI', () => {
  it('renders unpaired status and shows unpaired banner when no credentials exist', async () => {
    const { initPopup } = await import('./popup.js');
    initPopup();

    const statusText = document.getElementById('status-text')!;
    const statusChip = document.getElementById('status-chip')!;
    const pairingInfo = document.getElementById('pairing-info')!;
    const connectionDesc = document.getElementById('connection-desc')!;
    const unpairedBanner = document.getElementById('unpaired-banner')!;

    expect(statusText.textContent).toBe('Unpaired');
    expect(statusChip.dataset.state).toBe('off');
    expect(pairingInfo.textContent).toBe('Not paired');
    expect(connectionDesc.textContent).toBe('Extension not paired yet');
    expect(unpairedBanner.hasAttribute('hidden')).toBe(false);
  });

  it('renders off status when paired but connection is disabled', async () => {
    stored.token = 'tok';
    stored.wsUrl = 'ws://127.0.0.1:47833';
    stored.enabled = false;
    stored.profileName = 'Work Profile';

    const { initPopup } = await import('./popup.js');
    initPopup();

    const toggle = document.getElementById('connection-toggle') as HTMLInputElement;
    const profileInput = document.getElementById('profile-name') as HTMLInputElement;
    const statusText = document.getElementById('status-text')!;
    const statusChip = document.getElementById('status-chip')!;
    const pairingInfo = document.getElementById('pairing-info')!;
    const unpairedBanner = document.getElementById('unpaired-banner')!;

    expect(toggle.checked).toBe(false);
    expect(profileInput.value).toBe('Work Profile');
    expect(statusText.textContent).toBe('Off');
    expect(statusChip.dataset.state).toBe('off');
    expect(pairingInfo.textContent).toBe('Paired');
    expect(unpairedBanner.hasAttribute('hidden')).toBe(true);
  });

  it('renders connected status when paired and service worker reports connected', async () => {
    stored.token = 'tok';
    stored.wsUrl = 'ws://127.0.0.1:47833';
    stored.enabled = true;

    const { initPopup } = await import('./popup.js');
    initPopup();

    const statusText = document.getElementById('status-text')!;
    const statusChip = document.getElementById('status-chip')!;
    const connectionDesc = document.getElementById('connection-desc')!;

    expect(statusText.textContent).toBe('Connected');
    expect(statusChip.dataset.state).toBe('ok');
    expect(connectionDesc.textContent).toBe('Active in this profile');
  });

  it('renders connecting status when service worker reports disconnected', async () => {
    stored.token = 'tok';
    stored.wsUrl = 'ws://127.0.0.1:47833';
    stored.enabled = true;

    (globalThis as any).chrome.runtime.sendMessage = (
      message: unknown,
      callback?: (response?: unknown) => void,
    ) => {
      sentMessages.push(message);
      callback?.({ connected: false });
    };

    const { initPopup } = await import('./popup.js');
    initPopup();

    const statusText = document.getElementById('status-text')!;
    const statusChip = document.getElementById('status-chip')!;
    const connectionDesc = document.getElementById('connection-desc')!;

    expect(statusText.textContent).toBe('Connecting');
    expect(statusChip.dataset.state).toBe('pending');
    expect(connectionDesc.textContent).toBe('Connecting to Aevra…');
  });

  it('toggles connection off and sends aevra:disconnect', async () => {
    stored.token = 'tok';
    stored.wsUrl = 'ws://127.0.0.1:47833';
    stored.enabled = true;

    const { initPopup } = await import('./popup.js');
    initPopup();

    const toggle = document.getElementById('connection-toggle') as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));

    expect(stored.enabled).toBe(false);
    expect(sentMessages).toContainEqual({ type: 'aevra:disconnect' });

    const statusText = document.getElementById('status-text')!;
    expect(statusText.textContent).toBe('Off');
  });

  it('toggles connection on and sends aevra:connect', async () => {
    stored.token = 'tok';
    stored.wsUrl = 'ws://127.0.0.1:47833';
    stored.enabled = false;

    const { initPopup } = await import('./popup.js');
    initPopup();

    const toggle = document.getElementById('connection-toggle') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    expect(stored.enabled).toBe(true);
    expect(sentMessages).toContainEqual({ type: 'aevra:connect' });

    const statusText = document.getElementById('status-text')!;
    expect(statusText.textContent).toBe('Connecting');
  });

  it('debounces and saves profile name on input and change', async () => {
    vi.useFakeTimers();
    try {
      const { initPopup } = await import('./popup.js');
      initPopup();

      const profileInput = document.getElementById('profile-name') as HTMLInputElement;
      const saveStatus = document.getElementById('save-status')!;

      profileInput.value = 'QA Browser';
      profileInput.dispatchEvent(new Event('input'));

      expect(stored.profileName).toBeUndefined();

      await vi.advanceTimersByTimeAsync(300);
      expect(stored.profileName).toBe('QA Browser');
      expect(saveStatus.classList.contains('visible')).toBe(true);

      await vi.advanceTimersByTimeAsync(1300);
      expect(saveStatus.classList.contains('visible')).toBe(false);

      profileInput.value = 'Dev Profile';
      profileInput.dispatchEvent(new Event('change'));
      expect(stored.profileName).toBe('Dev Profile');
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles missing DOM elements without throwing', async () => {
    document.body.innerHTML = '<div>empty</div>';
    const { initPopup } = await import('./popup.js');
    expect(() => initPopup()).not.toThrow();
  });

  it('handles chrome.runtime.lastError when querying status', async () => {
    stored.token = 'tok';
    stored.wsUrl = 'ws://127.0.0.1:47833';
    stored.enabled = true;

    (globalThis as any).chrome.runtime.lastError = { message: 'no receiver' };
    (globalThis as any).chrome.runtime.sendMessage = (
      _msg: unknown,
      cb?: (res?: unknown) => void,
    ) => {
      cb?.();
    };

    const { initPopup } = await import('./popup.js');
    initPopup();
    const statusText = document.getElementById('status-text')!;
    expect(statusText.textContent).toBe('Connecting');
  });

  it('handles runtime.sendMessage throwing synchronously', async () => {
    stored.token = 'tok';
    stored.wsUrl = 'ws://127.0.0.1:47833';
    stored.enabled = true;

    (globalThis as any).chrome.runtime.sendMessage = () => {
      throw new Error('context invalidated');
    };

    const { initPopup } = await import('./popup.js');
    expect(() => initPopup()).not.toThrow();
  });
});
