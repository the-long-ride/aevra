import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CoreConfig } from '../../core/src/config.js';
import { runStart, type RunStartDependencies } from './run.js';

type Ports = Pick<CoreConfig, 'publicPort' | 'adminPort' | 'mcpPort' | 'browserPort'>;
interface Record {
  version: 1;
  pid: number;
  owner: string;
  ports: Ports;
}

function urlPort(url: string): number {
  const parsed = new URL(url);
  return Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
}

function read(config: CoreConfig): Record | undefined {
  try {
    const record = JSON.parse(readFileSync(path.join(config.stateDir, 'listeners.json'), 'utf8'));
    if (
      record.version !== 1 ||
      !Number.isInteger(record.pid) ||
      record.pid < 1 ||
      typeof record.owner !== 'string' ||
      !record.ports
    )
      return;
    const keys = ['publicPort', 'adminPort', 'mcpPort', 'browserPort'];
    if (
      !keys.every(
        (key) =>
          Number.isInteger(record.ports[key]) &&
          record.ports[key] > 0 &&
          record.ports[key] <= 65535,
      )
    )
      return;
    return record;
  } catch {
    return;
  }
}

/** Follow the live instance in this state directory without rewriting saved configuration. */
export function activeListenerConfig(config: CoreConfig): CoreConfig {
  const record = read(config);
  if (!record) return config;
  try {
    process.kill(record.pid, 0);
  } catch {
    return config;
  }
  const { publicPort, adminPort, mcpPort, browserPort } = record.ports;
  return { ...config, publicPort, adminPort, mcpPort, browserPort };
}

export async function runStartWithDiscovery(config: CoreConfig, deps: RunStartDependencies) {
  const file = path.join(config.stateDir, 'listeners.json');
  const owner = randomUUID();
  const temporary = `${file}.${owner}.tmp`;
  try {
    return await runStart(config, {
      ...deps,
      async onReady(info) {
        const record: Record = {
          version: 1,
          pid: process.pid,
          owner,
          ports: {
            publicPort: urlPort(info.gatewayUrl),
            adminPort: urlPort(info.adminUrl),
            mcpPort: urlPort(info.mcpUrl),
            browserPort: config.browserPort ?? 47833,
          },
        };
        writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
        renameSync(temporary, file);
        await deps.onReady?.(info);
      },
    });
  } finally {
    rmSync(temporary, { force: true });
    if (read(config)?.owner === owner) rmSync(file, { force: true });
  }
}
