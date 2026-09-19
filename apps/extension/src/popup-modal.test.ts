import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stored: Record<string, unknown> = {};
const sentMessages: unknown[] = [];

function renderModalDOM() {
  document.body.innerHTML = `
    <div class="header">
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
      <input type="text" id="profile-name" />
    </div>
    <div class="footer">
      <button type="button" id="open-pair-modal">Pair with Aevra</button>
      <span id="pairing-info"></span>
    </div>

    <div id="pair-modal" hidden>
      <button type="button" id="pair-modal-close">×</button>
      <form id="pair-form">
        <input type="text" id="pair-code" required />
        <input type="number" id="pair-port" value="47831" />
        <p id="pair-status"></p>
        <button type="button" id="pair-modal-cancel">Cancel</button>
        <button type="submit" id="pair-modal-submit">Pair</button>
      </form>
    </div>
  `;
}

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(stored)) delete stored[key];
  sentMessages.length = 0;
  renderModalDOM();

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

describe('popup pair modal interactions', () => {
  it('opens and closes the pair modal via open button, close button, cancel button, backdrop and Escape', async () => {
    const { initPopup } = await import('./popup.js');
    initPopup();

    const pairModal = document.getElementById('pair-modal')!;
    const openBtn = document.getElementById('open-pair-modal')!;
    const bannerBtn = document.getElementById('banner-pair-btn')!;
    const closeBtn = document.getElementById('pair-modal-close')!;
    const cancelBtn = document.getElementById('pair-modal-cancel')!;

    expect(pairModal.hasAttribute('hidden')).toBe(true);

    // Open via footer button
    openBtn.dispatchEvent(new Event('click'));
    expect(pairModal.hasAttribute('hidden')).toBe(false);

    // Close via close button
    closeBtn.dispatchEvent(new Event('click'));
    expect(pairModal.hasAttribute('hidden')).toBe(true);

    // Open via banner button
    bannerBtn.dispatchEvent(new Event('click'));
    expect(pairModal.hasAttribute('hidden')).toBe(false);

    // Close via cancel button
    cancelBtn.dispatchEvent(new Event('click'));
    expect(pairModal.hasAttribute('hidden')).toBe(true);

    // Open and close via backdrop click
    openBtn.dispatchEvent(new Event('click'));
    expect(pairModal.hasAttribute('hidden')).toBe(false);
    pairModal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(pairModal.hasAttribute('hidden')).toBe(true);

    // Open and close via Escape key
    openBtn.dispatchEvent(new Event('click'));
    expect(pairModal.hasAttribute('hidden')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(pairModal.hasAttribute('hidden')).toBe(true);
  });

  it('submits pairing form successfully in modal and updates UI state', async () => {
    vi.useFakeTimers();
    try {
      (globalThis as any).fetch = async () => ({
        ok: true,
        json: async () => ({ token: 'new-token', wsUrl: 'ws://127.0.0.1:47833' }),
      });

      const { initPopup } = await import('./popup.js');
      initPopup();

      const pairModal = document.getElementById('pair-modal')!;
      const codeInput = document.getElementById('pair-code') as HTMLInputElement;
      const portInput = document.getElementById('pair-port') as HTMLInputElement;
      const pairForm = document.getElementById('pair-form') as HTMLFormElement;
      const pairStatus = document.getElementById('pair-status')!;

      codeInput.value = 'abcd1234';
      portInput.value = '47831';

      pairForm.dispatchEvent(new Event('submit', { cancelable: true }));

      await vi.waitFor(() => expect(pairStatus.textContent).toBe('Paired over https.'));

      // Fast-forward 600ms for modal auto-close and live status query
      await vi.advanceTimersByTimeAsync(600);
      expect(pairModal.hasAttribute('hidden')).toBe(true);

      const statusChip = document.getElementById('status-chip')!;
      const statusText = document.getElementById('status-text')!;
      expect(statusChip.dataset.state).toBe('ok');
      expect(statusText.textContent).toBe('Connected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('displays error in modal when pairing submission fails', async () => {
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'PAIRING_FAILED' } }),
    });

    const { initPopup } = await import('./popup.js');
    initPopup();

    const codeInput = document.getElementById('pair-code') as HTMLInputElement;
    const pairForm = document.getElementById('pair-form') as HTMLFormElement;
    const pairStatus = document.getElementById('pair-status')!;

    codeInput.value = 'BADCODE';
    pairForm.dispatchEvent(new Event('submit', { cancelable: true }));

    await vi.waitFor(() => expect(pairStatus.textContent).toBe('Pairing failed: PAIRING_FAILED'));
  });

  it('ignores non-Escape keys and Escape when modal is already closed', async () => {
    const { initPopup } = await import('./popup.js');
    initPopup();

    const pairModal = document.getElementById('pair-modal')!;
    expect(pairModal.hasAttribute('hidden')).toBe(true);

    // Escape while hidden
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(pairModal.hasAttribute('hidden')).toBe(true);

    // Other key while open
    pairModal.removeAttribute('hidden');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(pairModal.hasAttribute('hidden')).toBe(false);
  });
});
