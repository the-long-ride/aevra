export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: init.cache ?? 'no-store',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const value: unknown = contentType.includes('json')
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const record =
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    const error =
      typeof record.error === 'object' && record.error !== null
        ? (record.error as Record<string, unknown>)
        : {};
    const message = error.message ?? record.error ?? record.message ?? `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return value as T;
}

export async function requestText(path: string, init: RequestInit = {}): Promise<string> {
  const response = await fetch(path, {
    ...init,
    cache: init.cache ?? 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
