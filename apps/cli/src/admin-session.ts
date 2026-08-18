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
  base(config: Config): string;
  fetch(
    config: Config,
    path: string,
    init?: AdminRequestInit,
  ): Promise<AdminResponseLike>;
}

async function bootstrapToken<Config>(
  config: Config,
  dependencies: AdminSessionDependencies<Config>,
): Promise<string> {
  const secret = await dependencies.controlSecret(config);
  const response = await dependencies.fetch(config, '/api/local/bootstrap', {
    method: 'POST',
    headers: { 'x-aevra-control': secret },
  });
  if (!response.ok) {
    throw new Error(`Core returned ${response.status}`);
  }
  const value = (await response.json()) as { token?: unknown };
  if (typeof value.token !== 'string' || value.token.length === 0) {
    throw new Error('Core returned an invalid local bootstrap token');
  }
  return value.token;
}

export async function adminApi<Config>(
  config: Config,
  path: string,
  init: AdminRequestInit | undefined,
  dependencies: AdminSessionDependencies<Config>,
): Promise<AdminResponseLike> {
  const token = await bootstrapToken(config, dependencies);
  const auth = await dependencies.fetch(
    config,
    `/auth/bootstrap?token=${encodeURIComponent(token)}`,
  );
  const cookie = (auth.headers.get('set-cookie') ?? '').split(';')[0];
  if (!cookie) {
    throw new Error('Core did not issue a local admin session cookie');
  }
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
): Promise<string> {
  const token = await bootstrapToken(config, dependencies);
  return `${dependencies.base(config)}/auth/bootstrap?token=${encodeURIComponent(token)}`;
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
  if (!response.ok) {
    throw new Error(`Core returned ${response.status}`);
  }
  return response.status;
}
