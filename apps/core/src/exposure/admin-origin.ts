function parseAdminUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials`);
  if (url.hostname.includes('*')) throw new Error(`${label} must not contain wildcard hosts`);
  return url;
}

export function normalizeAdminPublicUrl(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const url = parseAdminUrl(trimmed, 'Admin public URL');
  url.search = '';
  url.hash = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function normalizeAdminOrigin(value: string): string {
  return parseAdminUrl(value.trim(), 'Trusted Admin origin').origin;
}

export function normalizeTrustedAdminOrigins(values?: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values ?? []) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    unique.add(normalizeAdminOrigin(trimmed));
  }
  return [...unique];
}
