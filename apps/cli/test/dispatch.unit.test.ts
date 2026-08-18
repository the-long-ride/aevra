import assert from 'node:assert/strict';
import test from 'node:test';
import type { AevraCommand } from '../src/args.js';
import {
  dispatchCommand,
  type CliDispatchHandlers,
} from '../src/dispatch.js';

const commands: Array<[keyof CliDispatchHandlers, AevraCommand]> = [
  ['help', { command: 'help' }],
  ['start', { command: 'start', ui: false }],
  ['ui', { command: 'ui', logoutAll: false }],
  ['setup', { command: 'setup' }],
  ['service', { command: 'service', action: 'status' }],
  ['connectors', { command: 'connectors', action: 'list' }],
  ['status', { command: 'status', json: false }],
  ['backup', { command: 'backup', action: 'verify', file: 'backup.db', yes: false }],
  ['audit', { command: 'audit', action: 'clear', yes: true }],
  ['sessions', { command: 'sessions', action: 'revoke-others', yes: true }],
  ['completion', { command: 'completion', shell: 'bash' }],
];

for (const [name, command] of commands) {
  test(`dispatches ${name} to its handler`, async () => {
    const calls: AevraCommand[] = [];
    const handlers = new Proxy(
      {},
      {
        get(_target, property) {
          return async (received: AevraCommand) => {
            if (property === name) {
              calls.push(received);
              return 7;
            }
            return 99;
          };
        },
      },
    ) as CliDispatchHandlers;

    const result = await dispatchCommand(command, handlers);

    assert.equal(result, 7);
    assert.deepEqual(calls, [command]);
  });
}
