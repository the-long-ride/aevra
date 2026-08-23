import assert from 'node:assert/strict';
import test from 'node:test';
import { searchTool } from '../src/search-tool.js';

function context(searchMaxQueries = 2) {
  const calls: any[] = [];
  const lease = {
    id: 'lease-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    actor: 'oauth:test',
    capabilities: ['files.search'],
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  return {
    calls,
    value: {
      sessions: {
        get: () => ({ id: 'session-1', actor: 'oauth:test', subject: 'subject' }),
        activeLease: () => lease,
        leaseForWorkspace: () => lease,
        isYolo: () => false,
      },
      workspaces: {
        capabilityRoots: () => [
          {
            id: 'root',
            kind: 'workspace',
            logicalPrefix: '/',
            hostRoot: '/tmp/workspace',
            capabilities: ['files.search'],
          },
        ],
      },
      worker: {
        async execute(input: any) {
          calls.push(input);
          return { ok: true, value: { results: [] } };
        },
      },
      deps: {
        settings: {
          get: () => ({ searchMaxQueries }),
        },
      },
      oneTimeCapabilities: new Set<string>(),
    } as any,
  };
}

test('search enforces configured N and dispatches one parallel worker operation', async () => {
  const setup = context(2);
  await assert.rejects(
    () =>
      searchTool(setup.value, 'session-1', {
        queries: [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
      }),
    /between 1 and 2 queries/,
  );
  assert.equal(setup.calls.length, 0);

  await searchTool(setup.value, 'session-1', {
    path: '/src',
    queries: [
      { value: 'alpha' },
      { value: 'beta.*', mode: 'regex', path: '/packages' },
    ],
  });
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0].operation.kind, 'search.multi');
  assert.deepEqual(setup.calls[0].operation.queries, [
    { value: 'alpha', mode: 'text', path: '/src' },
    { value: 'beta.*', mode: 'regex', path: '/packages' },
  ]);
});
