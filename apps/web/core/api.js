export async function requestJson(path, init = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(init.headers ?? {}),
  };
  const response = await fetch(path, {
    ...init,
    headers,
    cache: init.cache ?? 'no-store',
  });
  const contentType = response.headers.get('content-type') ?? '';
  const value = contentType.includes('json')
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const message =
      value?.error?.message ??
      value?.error ??
      value?.message ??
      `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return value;
}

export async function requestText(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    cache: init.cache ?? 'no-store',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}
