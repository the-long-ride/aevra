import type { AdminUiDestination } from './args.js';

interface HeadersLike {
  get(name: string): string | null;
}

export interface AdminResponseLike {
  ok: boolean;
  status: number;
  headers: HeadersLike;
  json(): Promise<unknown>;
}

export interface AdminRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface AdminSessionDependencies<Config> {
  controlSecret(config: Config): Promise<string>;
  credentials(config: Config): Promise<{ username: string; password: string }>;
  base(config: Config): string;
  fetch(config: Config, path: string, init?: AdminRequestInit): Promise<AdminResponseLike>;
}

async function loginCookie<Config>(
  config: Config,
  dependencies: AdminSessionDependencies<Config>,
): Promise<string> {
  const credentials = await dependencies.credentials(config);
  const base = dependencies.base(config);
  const response = await dependencies.fetch(config, '/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: base,
    },
    body: JSON.stringify(credentials),
  });
  if (!response.ok) throw new Error(`Core returned ${response.status}`);
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
  if (!cookie) throw new Error('Core did not issue an admin session cookie');
  return cookie;
}

export async function adminApi<Config>(
  config: Config,
  path: string,
  init: AdminRequestInit | undefined,
  dependencies: AdminSessionDependencies<Config>,
): Promise<AdminResponseLike> {
  const cookie = await loginCookie(config, dependencies);
  return dependencies.fetch(config, path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      cookie,
    },
  });
}

export async function createAuthenticatedUiUrl<Config>(
  config: Config,
  dependencies: AdminSessionDependencies<Config>,
  _destination: AdminUiDestination = '/',
): Promise<string> {
  return `${dependencies.base(config).replace(/\/$/, '')}/`;
}

export async function revokeAllAdminSessions<Config>(
  config: Config,
  dependencies: AdminSessionDependencies<Config>,
): Promise<number> {
  const secret = await dependencies.controlSecret(config);
  const response = await dependencies.fetch(config, '/api/local/logout-all', {
    method: 'POST',
    headers: { 'x-aevra-control': secret },
  });
  if (!response.ok) throw new Error(`Core returned ${response.status}`);
  return response.status;
}
