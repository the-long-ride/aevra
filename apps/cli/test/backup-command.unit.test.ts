import assert from 'node:assert/strict';
import test from 'node:test';
import { runBackupCommand } from '../src/commands/backup-command.js';

function fixture(overrides: Partial<{
  inspect(file: string): {
    file: string;
    integrityOk: boolean;
    integrityMessage: string;
    sizeBytes: number;
    counts: Record<string, number>;
  };
  restore(file: string, stateDir: string): {
    databasePath: string;
    previousBackedUpTo?: string | null;
  };
  health(config: { stateDir: string }): Promise<{ ok: boolean }>;
}> = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    dependencies: {
      inspect: () => ({
        file: 'backup.db',
        integrityOk: true,
        integrityMessage: 'ok',
        sizeBytes: 10,
        counts: { workspaces: 1, connectors: 2, sessions: 3, audit_events: 4 },
      }),
      restore: () => ({
        databasePath: '/state/aevra.db',
        previousBackedUpTo: '/state/pre.db',
      }),
      health: async () => ({ ok: false }),
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ...overrides,
    },
  };
}

test('backup verify reports integrity and counts', async () => {
  const state = fixture();

  const code = await runBackupCommand(
    { stateDir: '/state' },
    { command: 'backup', action: 'verify', file: 'backup.db', yes: false },
    state.dependencies,
  );

  assert.equal(code, 0);
  assert.match(state.logs.join('\n'), /integrity: ok/);
  assert.match(state.logs.join('\n'), /workspaces: 1/);
});

test('backup restore requires explicit confirmation', async () => {
  const state = fixture();

  const code = await runBackupCommand(
    { stateDir: '/state' },
    { command: 'backup', action: 'restore', file: 'backup.db', yes: false },
    state.dependencies,
  );

  assert.equal(code, 1);
  assert.match(state.errors[0]!, /--yes/);
});

test('backup restore refuses a running daemon', async () => {
  const state = fixture({ health: async () => ({ ok: true }) });

  const code = await runBackupCommand(
    { stateDir: '/state' },
    { command: 'backup', action: 'restore', file: 'backup.db', yes: true },
    state.dependencies,
  );

  assert.equal(code, 1);
  assert.match(state.errors[0]!, /daemon is running/);
});

test('backup restore logs restored database path', async () => {
  const state = fixture();

  const code = await runBackupCommand(
    { stateDir: '/state' },
    { command: 'backup', action: 'restore', file: 'backup.db', yes: true },
    state.dependencies,
  );

  assert.equal(code, 0);
  assert.match(state.logs[0]!, /Restored \/state\/aevra\.db/);
});
