import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentOptions } from '../src/types.js';

export function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Temp home, temp project root and a credential adapter that issues plain-word tokens. The
// engine locates git through `options.env`, so each call passes the current PATH on.
export function workspaceFixture() {
  const base = mkdtempSync(path.join(tmpdir(), 'aevra-ws-'));
  const home = path.join(base, 'home');
  const root = path.join(base, 'project');
  mkdirSync(home);
  mkdirSync(root);
  const created: string[] = [];
  const revoked: string[] = [];
  const options = (extra: Partial<AgentOptions> = {}): AgentOptions => ({
    home,
    env: { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT },
    product: 'aevra',
    target: 'codex',
    operation: 'install',
    transport: 'stdio',
    executable: process.execPath,
    entrypoint: '/cli.js',
    stateDir: path.join(home, 'state'),
    endpoint: 'http://localhost:47832/mcp',
    scope: 'workspace',
    workspaceRoot: root,
    credentials: {
      async create() {
        created.push('heron');
        return { id: `cred-heron-${created.length}`, token: 'pelican' };
      },
      async revoke(id) {
        revoked.push(id);
      },
    },
    ...extra,
  });
  return {
    base,
    home,
    root,
    created,
    revoked,
    options,
    close: () => rmSync(base, { recursive: true, force: true }),
  };
}
