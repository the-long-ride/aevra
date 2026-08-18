import assert from 'node:assert/strict';
import test from 'node:test';
import { runUiCommand } from '../src/commands/ui-command.js';

test('ui opens the authenticated dashboard URL', async () => {
  const opened: string[] = [];
  const errors: string[] = [];

  const code = await runUiCommand(
    {},
    { command: 'ui', logoutAll: false },
    {
      createUrl: async () => 'https://localhost:47831/auth/bootstrap?token=abc',
      revokeAll: async () => 200,
      openBrowser: (url) => opened.push(url),
      error: (message) => errors.push(message),
      formatError: (error) => (error instanceof Error ? error.message : String(error)),
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(opened, ['https://localhost:47831/auth/bootstrap?token=abc']);
  assert.match(errors[0]!, /Opening https:\/\/localhost:47831/);
});

test('ui logout-all revokes sessions without opening a browser', async () => {
  let revoked = 0;
  const opened: string[] = [];
  const errors: string[] = [];

  const code = await runUiCommand(
    {},
    { command: 'ui', logoutAll: true },
    {
      createUrl: async () => 'unused',
      revokeAll: async () => {
        revoked += 1;
        return 200;
      },
      openBrowser: (url) => opened.push(url),
      error: (message) => errors.push(message),
      formatError: (error) => (error instanceof Error ? error.message : String(error)),
    },
  );

  assert.equal(code, 0);
  assert.equal(revoked, 1);
  assert.deepEqual(opened, []);
  assert.match(errors[0]!, /Revoked all local admin sessions/);
});

test('ui reports connection failures', async () => {
  const errors: string[] = [];

  const code = await runUiCommand(
    {},
    { command: 'ui', logoutAll: false },
    {
      createUrl: async () => {
        throw new Error('offline');
      },
      revokeAll: async () => 200,
      openBrowser: () => {},
      error: (message) => errors.push(message),
      formatError: (error) => (error instanceof Error ? error.message : String(error)),
    },
  );

  assert.equal(code, 1);
  assert.match(errors[0]!, /offline/);
  assert.match(errors[0]!, /Is aevra start\/service running\?/);
});
