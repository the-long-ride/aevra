import { requestJson } from '../core/api.js';

function stateFor(key, status) {
  if (key === 'tunnel') {
    if (status?.tunnel === 'unconfigured') return 'off';
    if (status?.tunnelReachable === true) return 'ok';
    if (status?.tunnelReachable === false) return 'error';
    return status?.tunnel === 'configured' ? 'pending' : 'off';
  }
  const value = String(status?.[key] ?? '').toLowerCase();
  if (['running', 'ready', 'connected'].includes(value)) return 'ok';
  if (['starting', 'checking', 'reconnecting'].includes(value)) {
    return 'pending';
  }
  return 'error';
}

function detailFor(key, status) {
  if (key === 'tunnel') {
    if (status?.tunnelReachable === true) return 'reachable';
    if (status?.tunnelReachable === false) return 'unreachable';
    return status?.tunnel ?? 'unconfigured';
  }
  return status?.[key] ?? 'unavailable';
}

export function updateRuntimeStatus(status, pendingCount = 0) {
  const version = document.querySelector('#app-version');
  if (version && status?.version) {
    const value = String(status.version);
    version.textContent = value.startsWith('v') ? value : `v${value}`;
  }
  for (const chip of document.querySelectorAll('[data-health]')) {
    const key = chip.dataset.health;
    const state = stateFor(key, status);
    const detail = detailFor(key, status);
    chip.dataset.state = state;
    chip.title = `${key}: ${detail}`;
    chip.setAttribute('aria-label', `${key}: ${detail}`);
  }
  const requests = document.querySelector('#requests-count');
  if (requests) requests.textContent = String(pendingCount);
  document
    .querySelector('#open-requests')
    ?.classList.toggle('has-pending', pendingCount > 0);
  const safeMode = document.querySelector('#safe-mode-banner');
  if (safeMode) safeMode.hidden = status?.safeMode !== true;
}

export function startRuntimeStatus() {
  let stopped = false;
  const refresh = async () => {
    try {
      const [status, approvals, oauth] = await Promise.all([
        requestJson('/api/status'),
        requestJson('/api/approvals'),
        requestJson('/api/oauth/requests'),
      ]);
      if (!stopped) {
        updateRuntimeStatus(
          status,
          approvals.filter((item) => item.state === 'PENDING').length +
            oauth.length,
        );
      }
    } catch {
      if (!stopped) {
        updateRuntimeStatus({
          core: 'unavailable',
          worker: 'unavailable',
          mcp: 'unavailable',
          tunnel: 'unavailable',
        });
      }
    }
  };
  void refresh();
  const timer = setInterval(() => void refresh(), 2000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
