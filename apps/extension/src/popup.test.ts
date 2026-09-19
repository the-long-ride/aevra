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
    <div class="resources-card">
      <span id="extension-version">v0.1.0</span>
      <a href="https://www.npmjs.com/package/@the-long-ride/aevra" class="resource-link" id="link-npm">npm</a>
      <a href="https://github.com/the-long-ride/aevra" class="resource-link" id="link-repo">GitHub</a>
      <a href="https://github.com/the-long-ride/aevra/releases" class="resource-link" id="link-releases">Releases</a>
      <a href="https://github.com/the-long-ride/aevra/blob/main/CHANGELOG.md" class="resource-link" id="link-changelog">Changelog</a>
      <button type="button" id="check-update-btn">
        <span id="check-update-text">Check for update</span>
      </button>
      <div id="update-status" hidden></div>
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
  renderPopupDOM();

  (globalThis as any).chrome = {
    tabs: {
      create: vi.fn(),
    },
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
      getManifest: () => ({ version: '0.1.0' }),
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
    const { initPopup } = await import('./popup');
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

    const { initPopup } = await import('./popup');
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

    const { initPopup } = await import('./popup');
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

    const { initPopup } = await import('./popup');
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

    const { initPopup } = await import('./popup');
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

    const { initPopup } = await import('./popup');
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
      const { initPopup } = await import('./popup');
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

  it('opens and closes the pair modal via open button, close button, cancel button, backdrop and Escape', async () => {
    const { initPopup } = await import('./popup');
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

  it('submits pairing form successfully and stores token over TLS', async () => {
    vi.useFakeTimers();
    try {
      const requests: any[] = [];
      (globalThis as any).fetch = async (url: string, init: any) => {
        requests.push({ url, body: JSON.parse(init.body) });
        return {
          ok: true,
          json: async () => ({ token: 'new-token', wsUrl: 'ws://127.0.0.1:47833' }),
        };
      };

      const { initPopup } = await import('./popup');
      initPopup();

      const pairModal = document.getElementById('pair-modal')!;
      const codeInput = document.getElementById('pair-code') as HTMLInputElement;
      const portInput = document.getElementById('pair-port') as HTMLInputElement;
      const pairForm = document.getElementById('pair-form') as HTMLFormElement;
      const pairStatus = document.getElementById('pair-status')!;

      codeInput.value = 'abcd1234';
      portInput.value = '47831';

      pairForm.dispatchEvent(new Event('submit', { cancelable: true }));

      // Wait for async fetch in executePairing
      await vi.waitFor(() => expect(pairStatus.textContent).toBe('Paired over https.'));

      expect(requests[0].url).toContain('/api/browser/pair');
      expect(requests[0].body).toEqual({ code: 'ABCD1234', extensionId: 'mock-ext-id' });
      expect(stored).toEqual({ token: 'new-token', wsUrl: 'ws://127.0.0.1:47833' });
      expect(sentMessages).toContainEqual({ type: 'aevra:paired' });

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

  it('handles server errors without payload code', async () => {
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const { initPopup } = await import('./popup');
    initPopup();

    const codeInput = document.getElementById('pair-code') as HTMLInputElement;
    const pairForm = document.getElementById('pair-form') as HTMLFormElement;
    const pairStatus = document.getElementById('pair-status')!;

    codeInput.value = 'ERRORCODE';
    pairForm.dispatchEvent(new Event('submit', { cancelable: true }));

    await vi.waitFor(() => expect(pairStatus.textContent).toBe('Pairing failed: 500'));
  });

  it('ignores non-Escape keys and Escape when modal is already closed', async () => {
    const { initPopup } = await import('./popup');
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

    const { executePairing } = await import('./popup');
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

    const { initPopup } = await import('./popup');
    initPopup();

    const codeInput = document.getElementById('pair-code') as HTMLInputElement;
    const pairForm = document.getElementById('pair-form') as HTMLFormElement;
    const pairStatus = document.getElementById('pair-status')!;
    const submitBtn = document.getElementById('pair-modal-submit') as HTMLButtonElement;

    codeInput.value = 'TESTCODE';
    pairForm.dispatchEvent(new Event('submit', { cancelable: true }));

    await vi.waitFor(() =>
      expect(pairStatus.textContent).toContain('Pairing failed: Aevra is not reachable'),
    );
    expect(submitBtn.disabled).toBe(false);
  });

  it('reports server error code when pairing is refused by daemon', async () => {
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'PAIRING_CODE_EXPIRED' } }),
    });

    const { initPopup } = await import('./popup');
    initPopup();

    const codeInput = document.getElementById('pair-code') as HTMLInputElement;
    const pairForm = document.getElementById('pair-form') as HTMLFormElement;
    const pairStatus = document.getElementById('pair-status')!;

    codeInput.value = 'EXPIRED1';
    pairForm.dispatchEvent(new Event('submit', { cancelable: true }));

    await vi.waitFor(() =>
      expect(pairStatus.textContent).toBe('Pairing failed: PAIRING_CODE_EXPIRED'),
    );
  });

  it('resolves custom admin ports correctly and falls back for invalid inputs', async () => {
    const { resolveAdminPort } = await import('./popup');
    expect(resolveAdminPort('9443')).toBe(9443);
    expect(resolveAdminPort(9443)).toBe(9443);
    expect(resolveAdminPort('')).toBe(47831);
    expect(resolveAdminPort('invalid')).toBe(47831);
    expect(resolveAdminPort('-5')).toBe(47831);
    expect(resolveAdminPort('999999')).toBe(47831);
  });

  it('handles missing DOM elements without throwing', async () => {
    document.body.innerHTML = '<div>empty</div>';
    const { initPopup } = await import('./popup');
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

    const { initPopup } = await import('./popup');
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

    const { initPopup } = await import('./popup');
    expect(() => initPopup()).not.toThrow();
  });

  describe('resources and update checking', () => {
    it('isVersionOutdated correctly compares semantic versions', async () => {
      const { isVersionOutdated } = await import('./popup');
      expect(isVersionOutdated('0.1.0', '0.1.1')).toBe(true);
      expect(isVersionOutdated('0.1.0', '0.2.0')).toBe(true);
      expect(isVersionOutdated('0.1.0', '1.0.0')).toBe(true);
      expect(isVersionOutdated('v0.1.0', '0.1.1')).toBe(true);
      expect(isVersionOutdated('0.1.0', 'v0.1.1')).toBe(true);
      expect(isVersionOutdated('1.0.5', '1.0.5')).toBe(false);
      expect(isVersionOutdated('1.0.5', '1.0.4')).toBe(false);
      expect(isVersionOutdated('1.0.5', '0.9.9')).toBe(false);
      expect(isVersionOutdated(undefined, '1.0.0')).toBe(false);
      expect(isVersionOutdated('1.0.0', undefined)).toBe(false);
    });

    it('getExtensionVersion reads from manifest or falls back', async () => {
      const { getExtensionVersion } = await import('./popup');
      expect(getExtensionVersion()).toBe('0.1.0');

      (globalThis as any).chrome.runtime.getManifest = () => ({ version: '1.2.3' });
      expect(getExtensionVersion()).toBe('1.2.3');

      (globalThis as any).chrome.runtime.getManifest = () => {
        throw new Error('boom');
      };
      expect(getExtensionVersion()).toBe('0.1.0');
    });

    it('openExternalUrl delegates to chrome.tabs.create or window.open', async () => {
      const { openExternalUrl } = await import('./popup');
      const createSpy = (globalThis as any).chrome.tabs.create;
      openExternalUrl('https://example.com/test');
      expect(createSpy).toHaveBeenCalledWith({ url: 'https://example.com/test' });

      // Fallback when chrome.tabs.create throws
      createSpy.mockImplementationOnce(() => {
        throw new Error('not available');
      });
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      openExternalUrl('https://example.com/fallback');
      expect(windowOpenSpy).toHaveBeenCalledWith(
        'https://example.com/fallback',
        '_blank',
        'noopener,noreferrer',
      );
      windowOpenSpy.mockRestore();
    });

    it('checkExtensionUpdate reports update-available when tag is higher', async () => {
      const { checkExtensionUpdate } = await import('./popup');
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v1.0.0',
          html_url: 'https://github.com/the-long-ride/aevra/releases/tag/v1.0.0',
        }),
      } as Response);

      const result = await checkExtensionUpdate('0.1.0', fakeFetch as any);
      expect(result.status).toBe('update-available');
      expect(result.message).toBe('Update available: v1.0.0');
      expect(result.releaseUrl).toBe('https://github.com/the-long-ride/aevra/releases/tag/v1.0.0');
    });

    it('checkExtensionUpdate reports latest when current matches or exceeds tag', async () => {
      const { checkExtensionUpdate } = await import('./popup');
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v0.1.0',
          html_url: 'https://github.com/the-long-ride/aevra/releases/tag/v0.1.0',
        }),
      } as Response);

      const result = await checkExtensionUpdate('0.1.0', fakeFetch as any);
      expect(result.status).toBe('latest');
      expect(result.message).toContain('Up to date');
    });

    it('checkExtensionUpdate handles HTTP errors', async () => {
      const { checkExtensionUpdate } = await import('./popup');
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      } as Response);

      const result = await checkExtensionUpdate('0.1.0', fakeFetch as any);
      expect(result.status).toBe('error');
      expect(result.message).toContain('HTTP 403');
    });

    it('checkExtensionUpdate handles network exception and missing tag', async () => {
      const { checkExtensionUpdate } = await import('./popup');
      const rejectingFetch = vi.fn().mockRejectedValue(new Error('offline'));
      const netResult = await checkExtensionUpdate('0.1.0', rejectingFetch as any);
      expect(netResult.status).toBe('error');
      expect(netResult.message).toContain('Network error');

      const noTagFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);
      const noTagResult = await checkExtensionUpdate('0.1.0', noTagFetch as any);
      expect(noTagResult.status).toBe('error');
      expect(noTagResult.message).toContain('No release tag found');
    });

    it('initPopup sets version and wires clicking on resource links', async () => {
      const { initPopup } = await import('./popup');
      initPopup();

      const versionEl = document.getElementById('extension-version')!;
      expect(versionEl.textContent).toBe('v0.1.0');

      const createSpy = (globalThis as any).chrome.tabs.create;
      const npmLink = document.getElementById('link-npm')!;
      npmLink.click();
      expect(createSpy).toHaveBeenCalledWith({
        url: 'https://www.npmjs.com/package/@the-long-ride/aevra',
      });

      const repoLink = document.getElementById('link-repo')!;
      repoLink.click();
      expect(createSpy).toHaveBeenCalledWith({
        url: 'https://github.com/the-long-ride/aevra',
      });
    });

    it('clicking check for updates button renders update available status and link', async () => {
      (globalThis as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v2.0.0',
          html_url: 'https://github.com/the-long-ride/aevra/releases/tag/v2.0.0',
        }),
      });

      const { initPopup } = await import('./popup');
      initPopup();

      const checkBtn = document.getElementById('check-update-btn') as HTMLButtonElement;
      const statusEl = document.getElementById('update-status')!;

      checkBtn.click();
      // Wait microtasks for async check
      await vi.waitFor(() => expect(statusEl.className).toContain('available'));

      expect(statusEl.textContent).toContain('Update available: v2.0.0');
      const link = statusEl.querySelector('a')!;
      expect(link).not.toBeNull();
      expect(link.textContent).toContain('Get update');

      const createSpy = (globalThis as any).chrome.tabs.create;
      link.click();
      expect(createSpy).toHaveBeenCalledWith({
        url: 'https://github.com/the-long-ride/aevra/releases/tag/v2.0.0',
      });
    });

    it('clicking check for updates button renders up-to-date status', async () => {
      (globalThis as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v0.1.0',
          html_url: 'https://github.com/the-long-ride/aevra/releases/tag/v0.1.0',
        }),
      });

      const { initPopup } = await import('./popup');
      initPopup();

      const checkBtn = document.getElementById('check-update-btn') as HTMLButtonElement;
      const statusEl = document.getElementById('update-status')!;

      checkBtn.click();
      await vi.waitFor(() => expect(statusEl.className).toContain('latest'));
      expect(statusEl.textContent).toContain('Up to date');
    });

    it('clicking check for updates button renders error status and view releases link on failure', async () => {
      (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('network fail'));

      const { initPopup } = await import('./popup');
      initPopup();

      const checkBtn = document.getElementById('check-update-btn') as HTMLButtonElement;
      const statusEl = document.getElementById('update-status')!;

      checkBtn.click();
      await vi.waitFor(() => expect(statusEl.className).toContain('error'));
      expect(statusEl.textContent).toContain('Network error');

      const link = statusEl.querySelector('a')!;
      expect(link).not.toBeNull();
      expect(link.textContent).toContain('View releases');

      const createSpy = (globalThis as any).chrome.tabs.create;
      link.click();
      expect(createSpy).toHaveBeenCalledWith({
        url: 'https://github.com/the-long-ride/aevra/releases',
      });
    });
  });
});
