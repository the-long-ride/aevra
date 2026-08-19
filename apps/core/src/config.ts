import os from 'node:os';
import path from 'node:path';
export interface CoreConfig {
  adminHost: '127.0.0.1';
  adminPort: number;
  mcpHost: '127.0.0.1';
  mcpPort: number;
  stateDir: string;
  databasePath: string;
  recoveryDir: string;
  workerSocketPath: string;
  leaseIdleMs: number;
  approvalFastWaitMs: number;
  approvalLifetimeMs: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  tlsCaPath?: string;
  approvalLifetimeByRiskMs: Partial<Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', number>>;
}
function port(env: NodeJS.ProcessEnv, key: string, fallback: number) {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${key} must be 1..65535`);
  return n;
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
  const stateDir = defaultStateDir(env);
  const workerSocketPath = workerSocketPathForPlatform(stateDir);
  const tlsCertPath = env.AEVRA_TLS_CERT ? path.resolve(env.AEVRA_TLS_CERT) : undefined,
    tlsKeyPath = env.AEVRA_TLS_KEY ? path.resolve(env.AEVRA_TLS_KEY) : undefined,
    tlsCaPath = env.AEVRA_TLS_CA ? path.resolve(env.AEVRA_TLS_CA) : undefined;
  if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath))
    throw new Error('AEVRA_TLS_CERT and AEVRA_TLS_KEY must be set together');
  return {
    adminHost: '127.0.0.1',
    adminPort: port(env, 'AEVRA_ADMIN_PORT', 47831),
    mcpHost: '127.0.0.1',
    mcpPort: port(env, 'AEVRA_MCP_PORT', 47832),
    stateDir,
    databasePath: path.join(stateDir, 'aevra.db'),
    recoveryDir: path.join(stateDir, 'recovery'),
    workerSocketPath,
    leaseIdleMs: 30 * 60_000,
    approvalFastWaitMs: 20_000,
    approvalLifetimeMs: 5 * 60_000,
    tlsCertPath,
    tlsKeyPath,
    tlsCaPath,
    approvalLifetimeByRiskMs: { HIGH: 2 * 60_000, CRITICAL: 60_000 },
  };
}
