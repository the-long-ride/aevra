import type { AevraCommand } from '../args.js';

type BackupCommand = Extract<AevraCommand, { command: 'backup' }>;

interface BackupInspection {
  file: string;
  integrityOk: boolean;
  integrityMessage: string;
  sizeBytes: number;
  counts: Record<string, number>;
}

interface RestoreResult {
  databasePath: string;
  previousBackedUpTo?: string | null;
}

export interface BackupCommandDependencies<Config extends { stateDir: string }> {
  inspect(file: string): BackupInspection;
  restore(file: string, stateDir: string): RestoreResult;
  health(config: Config): Promise<{ ok: boolean }>;
  log(message: string): void;
  error(message: string): void;
  formatError(error: unknown): string;
}

export async function runBackupCommand<Config extends { stateDir: string }>(
  config: Config,
  command: BackupCommand,
  dependencies: BackupCommandDependencies<Config>,
): Promise<number> {
  try {
    if (command.action === 'verify') {
      const inspection = dependencies.inspect(command.file);
      dependencies.log(`file: ${inspection.file}`);
      dependencies.log(
        `integrity: ${inspection.integrityOk ? 'ok' : `BROKEN — ${inspection.integrityMessage}`}`,
      );
      dependencies.log(`size: ${inspection.sizeBytes} bytes`);
      for (const table of ['workspaces', 'connectors', 'sessions', 'audit_events']) {
        dependencies.log(`${table}: ${inspection.counts[table] ?? 0}`);
      }
      return inspection.integrityOk ? 0 : 1;
    }

    if (!command.yes) {
      dependencies.error(
        `[aevra] restore overwrites ${config.stateDir} — re-run with --yes to confirm. The current database is kept as a .pre-restore copy.`,
      );
      return 1;
    }

    try {
      const health = await dependencies.health(config);
      if (health.ok) {
        throw new Error('daemon is running — stop it before restoring');
      }
    } catch (error) {
      if (dependencies.formatError(error).includes('daemon is running')) {
        throw error;
      }
    }

    const result = dependencies.restore(command.file, config.stateDir);
    dependencies.log(
      `[aevra] Restored ${result.databasePath}${result.previousBackedUpTo ? ` (previous kept at ${result.previousBackedUpTo})` : ''}`,
    );
    return 0;
  } catch (error) {
    dependencies.error(`[aevra] backup failed: ${dependencies.formatError(error)}`);
    return 1;
  }
}
