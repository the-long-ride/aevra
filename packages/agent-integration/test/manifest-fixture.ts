import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentLocation } from '../src/adapters.js';
import type { AgentOptions } from '../src/types.js';

export function manifestFixture() {
  const home = mkdtempSync(path.join(tmpdir(), 'aevra-manifest-v2-'));
  const stateDir = path.join(home, 'state');
  const options: AgentOptions = {
    home,
    env: {},
    product: 'aevra',
    target: 'all',
    operation: 'status',
    transport: 'stdio',
    executable: process.execPath,
    entrypoint: '/cli.js',
    stateDir,
    endpoint: 'http://localhost:47832/mcp',
    credentials: {
      async create() {
        return { id: 'id', token: 'token' };
      },
      async revoke() {},
    },
  };
  const manifest = path.join(home, '.agents/aevra/aevra.json');
  const reg = (extra: Record<string, unknown> = {}) => {
    const target = (extra.target as 'codex') ?? 'codex';
    return {
      target,
      transport: 'stdio',
      config: agentLocation(target, home, {}).config,
      entryHash: 'hash',
      credentialId: 'id',
      credentialFile: path.join(stateDir, `agent-credentials/${target}-one.json`),
      credentialHash: 'hash',
      links: [],
      ...extra,
    };
  };
  const save = (version: number, registrations: unknown[]) => {
    mkdirSync(path.dirname(manifest), { recursive: true });
    writeFileSync(
      manifest,
      JSON.stringify({ version, product: 'aevra', skillHash: '', registrations }),
    );
  };
  return { home, options, reg, save, close: () => rmSync(home, { recursive: true, force: true }) };
}
