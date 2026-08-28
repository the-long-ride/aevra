import assert from 'node:assert/strict';
import test from 'node:test';
import { runStartCommand } from '../src/commands/start-command.js';

test('start warns when the local gateway uses HTTP while Admin and MCP remain HTTPS', async () => {
  const errors: string[] = [];
  const code = await runStartCommand(
    {},
    { command: 'start', uiDestination: null },
    {
      run: async (_config, hooks) => {
        await hooks.onReady({
          adminUrl: 'https://localhost:47831',
          mcpUrl: 'https://localhost:47832',
          gatewayUrl: 'http://127.0.0.1:47830',
        } as any);
        return 0;
      },
      readyLines: () => ['ready'],
      openUi: async () => {},
      error: (message) => errors.push(message),
      formatError: (error) => (error instanceof Error ? error.message : String(error)),
    },
  );

  assert.equal(code, 0);
  assert.ok(
    errors.some((line) => line.includes('HTTP is enabled only for the local gateway on 127.0.0.1')),
  );
  assert.ok(errors.some((line) => line.includes('Admin and MCP remain HTTPS')));
  assert.equal(errors.at(-1), '[aevra] Press Ctrl+C to stop Aevra.');
});
