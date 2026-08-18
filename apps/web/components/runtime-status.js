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

export function updateRuntimeStatus(status) {
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
}

export function startRuntimeStatus() {
  let stopped = false;
  const refresh = async () => {
    try {
      const status = await requestJson('/api/status');
      if (!stopped) updateRuntimeStatus(status);
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
