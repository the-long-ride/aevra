const FORM_CONTROLS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

export function shouldRefreshDashboard(container, activeElement, force = false) {
  if (force) return true;
  if (!activeElement || !container?.contains?.(activeElement)) return true;
  return !FORM_CONTROLS.has(String(activeElement.tagName ?? '').toUpperCase());
}
