import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import type { CoreConfig } from '../../core/src/config.js';
import { adminApi, type AdminRequestInit, type AdminSessionDependencies } from './admin-session.js';
import type { AgentCommandDependencies } from './commands/agent-command.js';
import { formatCliError } from './cli-support.js';
import { localAdminBase } from './local-client.js';
import { cleanupRootProduct } from './product-cleanup.js';

type Admin = AdminSessionDependencies<CoreConfig>;
export interface TerminalStreams {
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean };
}

function api(config: CoreConfig, admin: Admin) {
  return (path: string, init?: AdminRequestInit) =>
    adminApi(
      config,
      path,
      init?.method === 'POST'
        ? { ...init, headers: { ...init.headers, origin: localAdminBase(config) } }
        : init,
      admin,
    );
}

// A closed input (Ctrl-D, Ctrl-C) never settles `question`, so the close event is raced in:
// it counts as a refusal and the caller reports that nothing changed.
async function ask(streams: TerminalStreams, question: string): Promise<boolean> {
  const prompt = createInterface({ input: streams.input, output: streams.output });
  try {
    const closed = new Promise<string>((resolve) => prompt.once('close', () => resolve('')));
    const answer = await Promise.race([prompt.question(`${question} `), closed]);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

export function agentDependencies(
  config: CoreConfig,
  admin: Admin,
  streams: TerminalStreams = { input: stdin, output: stdout },
): AgentCommandDependencies {
  const call = api(config, admin);
  return {
    api: call,
    log: console.log,
    error: console.error,
    formatError: formatCliError,
    isInteractive: () => Boolean(streams.input.isTTY && streams.output.isTTY),
    confirm: (question) => ask(streams, question),
    async workspaces() {
      const response = await call('/api/workspaces', { method: 'GET' });
      if (!response.ok) throw new Error(`Core returned ${response.status}`);
      const rows = (await response.json()) as Array<{ id: unknown; name: unknown }>;
      return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
    },
  };
}

export function coreShutdown(config: CoreConfig, admin: Admin) {
  const call = api(config, admin);
  return async () => {
    const response = await call('/api/agents/shutdown', { method: 'POST' });
    if (!response.ok) throw new Error(`Core returned ${response.status}`);
  };
}

export function rootCleanup(config: CoreConfig, admin: Admin) {
  const shutdown = coreShutdown(config, admin);
  return (purge: boolean, dryRun: boolean) => cleanupRootProduct(config, purge, dryRun, shutdown);
}
