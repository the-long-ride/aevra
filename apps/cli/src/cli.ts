#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { CloudflareManagerImpl } from '../../core/src/cloudflare/manager.js';
import { loadCoreConfig } from '../../core/src/config.js';
import { createCoreRuntime } from '../../core/src/runtime.js';
import { createUserServiceAdapter } from '../../core/src/service/service-manager.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import {
  adminApi,
  createAuthenticatedUiUrl,
  revokeAllAdminSessions,
  type AdminSessionDependencies,
} from './admin-session.js';
import { parseAevraArgs } from './args.js';
import { runBackupCommand } from './commands/backup-command.js';
import { runConnectorsCommand } from './commands/connectors-command.js';
import { runMaintenanceCommand } from './commands/maintenance-command.js';
import { runServiceCommand } from './commands/service-command.js';
import { runSetupCommand } from './commands/setup-command.js';
import { runStartCommand } from './commands/start-command.js';
import { runStatusCommand } from './commands/status-command.js';
import { runUiCommand } from './commands/ui-command.js';
import {
  cloudflareSetupNeedsAccess,
  completionText,
  formatCliError,
  readyLines,
  usageText,
} from './cli-support.js';
import { dispatchCommand } from './dispatch.js';
import { localAdminBase, localAdminFetch } from './local-client.js';
import { runStart } from './run.js';

function openBrowser(url: string) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

function adminDependencies(
  config: ReturnType<typeof loadCoreConfig>,
): AdminSessionDependencies<ReturnType<typeof loadCoreConfig>> {
  return {
    async controlSecret() {
      return readFileSync(
        path.join(config.stateDir, 'local-control.secret'),
        'utf8',
      ).trim();
    },
    base: localAdminBase,
    fetch: (currentConfig, apiPath, init) =>
      localAdminFetch(currentConfig, apiPath, init),
  };
}

function setupResources(config: ReturnType<typeof loadCoreConfig>) {
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const database = AevraDatabase.open(config.databasePath);
  const settings = new SettingsRepository(database.raw());
  const manager = new CloudflareManagerImpl(
    settings,
    undefined,
    `https://localhost:${config.mcpPort}`,
  );
  const prompt = createInterface({ input, output });
  return {
    prompt,
    manager,
    close() {
      prompt.close();
      database.close();
    },
  };
}

async function runBackup(
  config: ReturnType<typeof loadCoreConfig>,
  command: Extract<ReturnType<typeof parseAevraArgs>, { command: 'backup' }>,
) {
  const { DatabaseSync } = await import('node:sqlite');
  const { inspectBackup, restoreBackup } = await import(
    '../../core/src/backup/verify.js'
  );
  return runBackupCommand(config, command, {
    inspect: (file) =>
      inspectBackup(file, (databaseFile) => {
        const database = new DatabaseSync(databaseFile);
        database.exec('PRAGMA busy_timeout=5000;');
        return database;
      }),
    restore: restoreBackup,
    health: (currentConfig) => localAdminFetch(currentConfig, '/api/health'),
    log: console.log,
    error: console.error,
    formatError: formatCliError,
  });
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let command;
  try {
    command = parseAevraArgs(argv);
  } catch (error) {
    console.error(`[aevra] ${formatCliError(error)}\n\n${usageText()}`);
    return 1;
  }

  if (command.command === 'help') {
    console.log(usageText());
    return 0;
  }

  const config = loadCoreConfig();
  const admin = adminDependencies(config);

  return dispatchCommand(command, {
    help: async () => 0,
    start: (current) =>
      runStartCommand(config, current, {
        run: (currentConfig, hooks) =>
          runStart(currentConfig, {
            signals: process,
            createRuntime: createCoreRuntime,
            onReady: hooks.onReady,
          }),
        readyLines,
        openUi: async () => {
          const url = await createAuthenticatedUiUrl(config, admin);
          openBrowser(url);
          console.error(`[aevra] Opening ${url}`);
        },
        error: console.error,
        formatError: formatCliError,
      }),
    ui: (current) =>
      runUiCommand(config, current, {
        createUrl: (currentConfig) => createAuthenticatedUiUrl(currentConfig, admin),
        revokeAll: (currentConfig) => revokeAllAdminSessions(currentConfig, admin),
        openBrowser,
        error: console.error,
        formatError: formatCliError,
      }),
    setup: (current) =>
      runSetupCommand(config, current, {
        isInteractive: () => Boolean(process.stdin.isTTY),
        prepare: setupResources,
        needsAccess: cloudflareSetupNeedsAccess,
        error: console.error,
        formatError: formatCliError,
      }),
    service: (current) =>
      runServiceCommand(
        current,
        createUserServiceAdapter(process.platform, process.execPath, process.argv[1]!),
        {
          log: console.log,
          error: console.error,
          formatError: formatCliError,
        },
      ),
    connectors: (current) =>
      runConnectorsCommand(config, current, {
        api: (currentConfig, apiPath, init) =>
          adminApi(currentConfig, apiPath, init, admin),
        log: console.log,
        error: console.error,
        formatError: formatCliError,
      }),
    status: (current) =>
      runStatusCommand(config, current, {
        fetch: (currentConfig, apiPath) =>
          localAdminFetch(currentConfig, apiPath),
        log: console.log,
        error: console.error,
        formatError: formatCliError,
      }),
    backup: (current) => runBackup(config, current),
    audit: (current) =>
      runMaintenanceCommand(config, current, {
        api: (currentConfig, apiPath, init) =>
          adminApi(currentConfig, apiPath, init, admin),
        log: console.log,
        error: console.error,
        formatError: formatCliError,
      }),
    sessions: (current) =>
      runMaintenanceCommand(config, current, {
        api: (currentConfig, apiPath, init) =>
          adminApi(currentConfig, apiPath, init, admin),
        log: console.log,
        error: console.error,
        formatError: formatCliError,
      }),
    completion: async (current) => {
      process.stdout.write(completionText(current.shell));
      return 0;
    },
  });
}

function isDirectCliEntry(moduleUrl: string, entryPath: string | undefined) {
  if (!entryPath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entryPath);
  } catch {
    return false;
  }
}

if (isDirectCliEntry(import.meta.url, process.argv[1])) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
