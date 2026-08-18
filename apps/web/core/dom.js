export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

export function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return fallback;
  }
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function card(title, body = '', className = '') {
  return `<section class="panel ${escapeHtml(className)}"><div class="panel-head"><h2>${escapeHtml(title)}</h2></div>${body}</section>`;
}

export function field(label, control, help = '') {
  return `<label class="field"><span>${escapeHtml(label)}</span>${control}${help ? `<small>${escapeHtml(help)}</small>` : ''}</label>`;
}
