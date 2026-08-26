import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { OperationRepository } from '../../../packages/store/src/operations.js';
import { ResumableOperationService } from '../src/operations/resumable-operation-service.js';
import { toolDefinitions } from '../../../packages/mcp-tools/src/registry.js';

test('operation repository persists durable connection identity and safe projections', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new OperationRepository(db.raw());
  repo.setConnectionResolver((sessionId) =>
    sessionId === 'ses_old' ? 'oauth_grant_1' : undefined,
  );
  repo.put({
    id: 'op_1',
    sessionId: 'ses_old',
    workspaceId: 'w1',
    kind: 'file.write',
    state: 'EXECUTING',
    intent: { content: 'secret-input-not-projected' },
  });
  repo.updateState('op_1', 'SUCCEEDED', { ok: true });

  const stored = repo.getById('op_1');
  assert.equal(stored?.connectionId, 'oauth_grant_1');
  assert.equal(stored?.state, 'SUCCEEDED');
  assert.deepEqual(stored?.result, { ok: true });
  assert.equal(JSON.stringify(stored).includes('secret-input-not-projected'), false);
  assert.equal(repo.listByConnection('oauth_grant_1', 500).length, 1);
  db.close();
});

test('operation projections normalize states, malformed results, null ownership, and list bounds', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new OperationRepository(db.raw());
  const states = [
    ['FAILED', 'FAILED'],
    ['CANCELLED', 'CANCELLED'],
    ['INTERRUPTED', 'CANCELLED'],
    ['EXECUTING', 'RUNNING'],
    ['AUTHORIZED', 'QUEUED'],
  ] as const;

  for (const [index, [state, expected]] of states.entries()) {
    repo.put({
      id: `op_state_${index}`,
      connectionId: 'oauth_grant_edges',
      kind: 'command.run',
      state,
      ...(index === 0 ? { result: { ok: false } } : {}),
    });
    assert.equal(repo.getById(`op_state_${index}`)?.state, expected);
  }

  repo.put({ id: 'op_unowned', kind: 'file.read', state: 'SUCCEEDED' });
  assert.equal(repo.getById('op_unowned'), null);
  assert.equal(repo.getById('missing'), null);
  assert.equal(repo.attachSession('missing', 'ses_new'), false);

  db.raw().prepare("UPDATE operations SET result_json='{' WHERE id='op_state_0'").run();
  assert.equal(repo.getById('op_state_0')?.result, undefined);
  assert.equal(repo.listByConnection('oauth_grant_edges', Number.NaN).length, states.length);
  assert.equal(repo.listByConnection('oauth_grant_edges', 0).length, 1);
  db.close();
});

test('same OAuth connection can inspect an operation after session recreation', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new OperationRepository(db.raw());
  repo.put({
    id: 'op_1',
    sessionId: 'ses_old',
    connectionId: 'oauth_grant_1',
    kind: 'file.write',
    state: 'SUCCEEDED',
    result: { hash: 'abc' },
  });
  const sessions = {
    get: (id: string) => (id === 'ses_new' || id === 'ses_other' ? { id } : null),
    connectionIdentity: (id: string) => ({
      connectionId: id === 'ses_new' ? 'oauth_grant_1' : 'oauth_grant_2',
    }),
    connectionState: () => ({ status: 'CONNECTED' }),
  } as any;
  const service = new ResumableOperationService(repo, sessions);

  const resumed = service.get('ses_new', 'op_1');
  assert.equal(resumed?.sessionId, 'ses_new');
  assert.equal(service.list('ses_new').length, 1);
  assert.equal(service.get('ses_other', 'op_1'), null);
  assert.deepEqual(service.list('ses_other'), []);
  db.close();
});

test('operation inspection rejects missing sessions and sessions without durable connection identity', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new OperationRepository(db.raw());
  const service = new ResumableOperationService(repo, {
    get: (id: string) => (id === 'ses_local' ? { id } : null),
    connectionIdentity: () => ({}),
    connectionState: () => null,
  } as any);

  assert.equal(service.get('missing', 'op_1'), null);
  assert.deepEqual(service.list('missing'), []);
  assert.equal(service.get('ses_local', 'op_1'), null);
  assert.deepEqual(service.list('ses_local'), []);
  db.close();
});

test('revoked connection cannot inspect operations', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new OperationRepository(db.raw());
  repo.put({
    id: 'op_1',
    sessionId: 'ses_1',
    connectionId: 'oauth_grant_1',
    kind: 'command.run',
    state: 'INTERRUPTED',
  });
  const service = new ResumableOperationService(repo, {
    get: () => ({ id: 'ses_1' }),
    connectionIdentity: () => ({ connectionId: 'oauth_grant_1' }),
    connectionState: () => ({ status: 'REVOKED' }),
  } as any);
  assert.equal(service.get('ses_1', 'op_1'), null);
  assert.deepEqual(service.list('ses_1'), []);
  db.close();
});

test('operation inspection tools are registered read-only with bounded schemas', () => {
  const tools = new Map(toolDefinitions().map((tool) => [tool.name, tool]));
  const get = tools.get('operation_get');
  const list = tools.get('operation_list');
  assert.equal(get?.annotations.readOnlyHint, true);
  assert.equal(list?.annotations.readOnlyHint, true);
  assert.deepEqual((get?.inputSchema as any).required, ['operationId']);
  assert.equal((list?.inputSchema as any).properties.limit.maximum, 100);
});
