import os from 'node:os';
import path from 'node:path';
import { AdminCredentialVerifier, loadAdminCredentials } from './admin/admin-credentials.js';

export interface CoreConfig {
  publicHost: '127.0.0.1';
  publicPort: number;
  adminHost: '127.0.0.1';
  adminPort: number;
  mcpHost: '127.0.0.1';
  mcpPort: number;
  stateDir: string;
  databasePath: string;
  recoveryDir: string;
  workerSocketPath: string;
  leaseIdleMs: number;
  oauthAccessTokenTtlMs: number;
  oauthRefreshTokenTtlMs: number;
  connectionReconnectGraceMs: number;
  approvalFastWaitMs: number;
  approvalLifetimeMs: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  tlsCaPath?: string;
  createAdminCredentialVerifier(): Promise<AdminCredentialVerifier>;
  approvalLifetimeByRiskMs: Partial<Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', number>>;
}

function port(env: NodeJS.ProcessEnv, key: string, fallback: number) {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${key} must be 1..65535`);
  return n;
}

function durationMs(env: NodeJS.ProcessEnv, key: string, fallback: number, allowZero = false) {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${key} must be a safe integer >= ${minimum}`);
  }
  return value;
}

export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AEVRA_STATE_DIR) return path.resolve(env.AEVRA_STATE_DIR);
  if (process.platform === 'win32') return path.join(env.LOCALAPPDATA ?? os.homedir(), 'Aevra');
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'Aevra');
  return path.join(env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'), 'aevra');
}

export function workerSocketPathForPlatform(
  stateDir: string,
  platform: NodeJS.Platform = process.platform,
  pid = process.pid,
): string {
  return platform === 'win32'
    ? `\\\\.\\pipe\\aevra-worker-${pid}`
    : path.join(stateDir, 'worker.sock');
}

export function loadCoreConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const adminCredentials = loadAdminCredentials(env);
  const stateDir = defaultStateDir(env);
  const workerSocketPath = workerSocketPathForPlatform(stateDir);
  const tlsCertPath = env.AEVRA_TLS_CERT ? path.resolve(env.AEVRA_TLS_CERT) : undefined,
    tlsKeyPath = env.AEVRA_TLS_KEY ? path.resolve(env.AEVRA_TLS_KEY) : undefined,
    tlsCaPath = env.AEVRA_TLS_CA ? path.resolve(env.AEVRA_TLS_CA) : undefined;
  if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath))
    throw new Error('AEVRA_TLS_CERT and AEVRA_TLS_KEY must be set together');
  const oauthAccessTokenTtlMs = durationMs(env, 'AEVRA_OAUTH_ACCESS_TOKEN_TTL_MS', 60 * 60_000);
  const oauthRefreshTokenTtlMs = durationMs(
    env,
    'AEVRA_OAUTH_REFRESH_TOKEN_TTL_MS',
    30 * 24 * 60 * 60_000,
  );
  if (oauthRefreshTokenTtlMs <= oauthAccessTokenTtlMs) {
    throw new Error('OAuth refresh token TTL must be greater than access token TTL');
  }
  const connectionReconnectGraceMs = durationMs(
    env,
    'AEVRA_CONNECTION_RECONNECT_GRACE_MS',
    15 * 60_000,
    true,
  );
  return {
    publicHost: '127.0.0.1',
    publicPort: port(env, 'AEVRA_PUBLIC_PORT', 47830),
    adminHost: '127.0.0.1',
    adminPort: port(env, 'AEVRA_ADMIN_PORT', 47831),
    mcpHost: '127.0.0.1',
    mcpPort: port(env, 'AEVRA_MCP_PORT', 47832),
    stateDir,
    databasePath: path.join(stateDir, 'aevra.db'),
    recoveryDir: path.join(stateDir, 'recovery'),
    workerSocketPath,
    leaseIdleMs: 30 * 60_000,
    oauthAccessTokenTtlMs,
    oauthRefreshTokenTtlMs,
    connectionReconnectGraceMs,
    approvalFastWaitMs: 20_000,
    approvalLifetimeMs: 5 * 60_000,
    tlsCertPath,
    tlsKeyPath,
    tlsCaPath,
    createAdminCredentialVerifier: () =>
      AdminCredentialVerifier.create(adminCredentials.username, adminCredentials.password),
    approvalLifetimeByRiskMs: { HIGH: 2 * 60_000, CRITICAL: 60_000 },
  };
}
