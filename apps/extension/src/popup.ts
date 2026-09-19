import { initPopupResources } from './popup-resources.js';

export {
  NPM_PACKAGE_URL,
  GITHUB_REPO_URL,
  GITHUB_RELEASES_URL,
  GITHUB_CHANGELOG_URL,
  GITHUB_LATEST_RELEASE_API,
  getExtensionVersion,
  openExternalUrl,
  isVersionOutdated,
  type UpdateCheckResult,
  checkExtensionUpdate,
  initPopupResources,
} from './popup-resources.js';

const DEFAULT_ADMIN_PORT = 47831;
const PAIR_PATH = '/api/browser/pair';

export function resolveAdminPort(value: unknown): number {
  const parsed = Number(value ?? '');
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_ADMIN_PORT;
}

async function postPair(
  scheme: 'https' | 'http',
  port: number,
  body: string,
): Promise<Response | null> {
  try {
    return await fetch(`${scheme}://127.0.0.1:${port}${PAIR_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  } catch {
    return null;
  }
}

export async function executePairing(
  code: string,
  portInput?: unknown,
): Promise<{ ok: boolean; message: string; token?: string; wsUrl?: string }> {
  const port = resolveAdminPort(portInput);
  const cleanCode = code.trim().toUpperCase();
  const body = JSON.stringify({
    code: cleanCode,
    extensionId: chrome.runtime?.id ?? '',
  });

  let scheme: 'https' | 'http' = 'https';
  let response = await postPair('https', port, body);
  if (!response) {
    scheme = 'http';
    response = await postPair('http', port, body);
  }
  if (!response) {
    return {
      ok: false,
      message:
        `Pairing failed: Aevra is not reachable on port ${port}, or its ` +
        'certificate has not been accepted in this browser yet. Open the Aevra ' +
        'admin UI once in this browser, accept the certificate, then pair again.',
    };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      message: `Pairing failed: ${payload?.error?.code ?? response.status}`,
    };
  }

  await chrome.storage.local.set({ token: payload.token, wsUrl: payload.wsUrl });
  chrome.runtime.sendMessage({ type: 'aevra:paired' });
  return {
    ok: true,
    message: `Paired over ${scheme}.`,
    token: payload.token,
    wsUrl: payload.wsUrl,
  };
}

export function initPopup(): void {
  const toggle = document.getElementById('connection-toggle') as HTMLInputElement | null;
  const connectionDesc = document.getElementById('connection-desc') as HTMLElement | null;
  const profileInput = document.getElementById('profile-name') as HTMLInputElement | null;
  const statusChip = document.getElementById('status-chip') as HTMLElement | null;
  const statusText = document.getElementById('status-text') as HTMLElement | null;
  const saveStatus = document.getElementById('save-status') as HTMLElement | null;
  const pairingInfo = document.getElementById('pairing-info') as HTMLElement | null;
  const unpairedBanner = document.getElementById('unpaired-banner') as HTMLElement | null;
  const openPairModalBtn = document.getElementById('open-pair-modal') as HTMLButtonElement | null;
  const bannerPairBtn = document.getElementById('banner-pair-btn') as HTMLButtonElement | null;

  // Modal elements
  const pairModal = document.getElementById('pair-modal') as HTMLElement | null;
  const pairModalClose = document.getElementById('pair-modal-close') as HTMLButtonElement | null;
  const pairModalCancel = document.getElementById('pair-modal-cancel') as HTMLButtonElement | null;
  const pairForm = document.getElementById('pair-form') as HTMLFormElement | null;
  const pairCodeInput = document.getElementById('pair-code') as HTMLInputElement | null;
  const pairPortInput = document.getElementById('pair-port') as HTMLInputElement | null;
  const pairStatus = document.getElementById('pair-status') as HTMLElement | null;
  const pairSubmitBtn = document.getElementById('pair-modal-submit') as HTMLButtonElement | null;

  if (!toggle || !profileInput) return;

  function renderStatus(isPaired: boolean, isEnabled: boolean, isConnected: boolean): void {
    if (!statusChip || !statusText || !connectionDesc || !pairingInfo) return;

    if (!isPaired) {
      statusChip.dataset.state = 'off';
      statusText.textContent = 'Unpaired';
      connectionDesc.textContent = 'Extension not paired yet';
      pairingInfo.textContent = 'Not paired';
      if (unpairedBanner) unpairedBanner.removeAttribute('hidden');
      return;
    }

    if (unpairedBanner) unpairedBanner.setAttribute('hidden', '');
    pairingInfo.textContent = 'Paired';

    if (!isEnabled) {
      statusChip.dataset.state = 'off';
      statusText.textContent = 'Off';
      connectionDesc.textContent = 'Connection paused';
      return;
    }

    if (isConnected) {
      statusChip.dataset.state = 'ok';
      statusText.textContent = 'Connected';
      connectionDesc.textContent = 'Active in this profile';
    } else {
      statusChip.dataset.state = 'pending';
      statusText.textContent = 'Connecting';
      connectionDesc.textContent = 'Connecting to Aevra…';
    }
  }

  void chrome.storage.local.get(
    ['token', 'wsUrl', 'enabled', 'profileName'],
    (stored: Record<string, unknown> = {}) => {
      const isPaired = Boolean(
        typeof stored.token === 'string' &&
        stored.token.length > 0 &&
        typeof stored.wsUrl === 'string' &&
        stored.wsUrl.length > 0,
      );
      const isEnabled = stored.enabled !== false;
      const profileName = typeof stored.profileName === 'string' ? stored.profileName : '';

      toggle.checked = isEnabled;
      profileInput.value = profileName;

      if (!isPaired || !isEnabled) {
        renderStatus(isPaired, isEnabled, false);
        return;
      }

      renderStatus(isPaired, isEnabled, false);
      try {
        chrome.runtime.sendMessage(
          { type: 'aevra:getStatus' },
          (response?: { connected?: boolean }) => {
            if (chrome.runtime.lastError) return;
            renderStatus(isPaired, isEnabled, Boolean(response?.connected));
          },
        );
      } catch {
        // Ignored if runtime is unreachable
      }
    },
  );

  toggle.addEventListener('change', () => {
    const isEnabled = toggle.checked;
    void chrome.storage.local.set({ enabled: isEnabled });

    if (isEnabled) {
      chrome.runtime.sendMessage({ type: 'aevra:connect' });
      renderStatus(true, true, false);
    } else {
      chrome.runtime.sendMessage({ type: 'aevra:disconnect' });
      renderStatus(true, false, false);
    }
  });

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function triggerSave(): void {
    const profileName = profileInput ? profileInput.value.trim() : '';
    void chrome.storage.local.set({ profileName });
    if (saveStatus) {
      saveStatus.classList.add('visible');
      setTimeout(() => {
        saveStatus.classList.remove('visible');
      }, 1200);
    }
  }

  profileInput.addEventListener('input', () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(triggerSave, 250);
  });

  profileInput.addEventListener('change', () => {
    if (saveTimer) clearTimeout(saveTimer);
    triggerSave();
  });

  // Modal controls
  function openModal(): void {
    if (!pairModal) return;
    pairModal.removeAttribute('hidden');
    if (pairStatus) {
      pairStatus.textContent = '';
      pairStatus.className = 'pair-status-msg';
    }
    if (pairSubmitBtn) pairSubmitBtn.disabled = false;
    pairCodeInput?.focus();
  }

  function closeModal(): void {
    if (!pairModal) return;
    pairModal.setAttribute('hidden', '');
    if (pairStatus) {
      pairStatus.textContent = '';
      pairStatus.className = 'pair-status-msg';
    }
    if (pairSubmitBtn) pairSubmitBtn.disabled = false;
  }

  openPairModalBtn?.addEventListener('click', openModal);
  bannerPairBtn?.addEventListener('click', openModal);
  pairModalClose?.addEventListener('click', closeModal);
  pairModalCancel?.addEventListener('click', closeModal);

  pairModal?.addEventListener('click', (event) => {
    if (event.target === pairModal) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && pairModal && !pairModal.hasAttribute('hidden')) {
      closeModal();
    }
  });

  pairForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pairCodeInput || !pairStatus || !pairSubmitBtn) return;

    const code = pairCodeInput.value;
    const port = pairPortInput?.value;

    pairSubmitBtn.disabled = true;
    pairStatus.className = 'pair-status-msg pending';
    pairStatus.textContent = 'Pairing…';

    void executePairing(code, port).then((result) => {
      if (!result.ok) {
        pairSubmitBtn.disabled = false;
        pairStatus.className = 'pair-status-msg error';
        pairStatus.textContent = result.message;
        return;
      }

      pairStatus.className = 'pair-status-msg success';
      pairStatus.textContent = result.message;
      pairCodeInput.value = '';

      renderStatus(true, toggle.checked, false);
      setTimeout(() => {
        closeModal();
        try {
          chrome.runtime.sendMessage(
            { type: 'aevra:getStatus' },
            (response?: { connected?: boolean }) => {
              if (chrome.runtime.lastError) return;
              renderStatus(true, toggle.checked, Boolean(response?.connected));
            },
          );
        } catch {}
      }, 500);
    });
  });

  // Resources & Update Check elements
  initPopupResources();
}

if (typeof document !== 'undefined') {
  initPopup();
}
