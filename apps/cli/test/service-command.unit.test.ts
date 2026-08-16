import assert from 'node:assert/strict';
import test from 'node:test';
import { runServiceCommand } from '../src/commands/service-command.js';

function fixture(
  overrides: Partial<{
    install(): Promise<unknown>;
    start(): Promise<unknown>;
    stop(): Promise<unknown>;
    restart(): Promise<unknown>;
    status(): Promise<string>;
  }> = {},
) {
  const calls: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const service = {
    install: async () => calls.push('install'),
    start: async () => calls.push('start'),
    stop: async () => calls.push('stop'),
    restart: async () => calls.push('restart'),
    status: async () => {
      calls.push('status');
      return 'running';
    },
    ...overrides,
  };
  return {
    calls,
    logs,
    errors,
    service,
    dependencies: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    },
  };
}

test('service status prints adapter status', async () => {
  const state = fixture();

  const code = await runServiceCommand(
    { command: 'service', action: 'status' },
    state.service,
    state.dependencies,
  );

  assert.equal(code, 0);
  assert.deepEqual(state.calls, ['status']);
  assert.deepEqual(state.logs, ['running']);
});

test('service action invokes matching adapter method', async () => {
  const state = fixture();

  const code = await runServiceCommand(
    { command: 'service', action: 'restart' },
    state.service,
    state.dependencies,
  );

  assert.equal(code, 0);
  assert.deepEqual(state.calls, ['restart']);
});

test('service failures report action and error', async () => {
  const state = fixture({
    start: async () => {
      throw new Error('denied');
    },
  });

  const code = await runServiceCommand(
    { command: 'service', action: 'start' },
    state.service,
    state.dependencies,
  );

  assert.equal(code, 1);
  assert.match(state.errors[0]!, /service start failed: denied/);
});
