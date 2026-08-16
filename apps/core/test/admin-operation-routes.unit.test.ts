import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleOperationRoutes } from '../src/admin/routes/operation-routes.js';

function request(method: string, body?: unknown) {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
  stream.method = method;
  stream.headers = {};
  return stream;
}

function response() {
  const result = {
    statusCode: 0,
    body: '',
    contentType: '',
    setHeader(_name: string, value: string) {
      result.contentType = value;
    },
    end(value = '') {
      result.body = String(value);
    },
  };
  return result as any;
}

function context() {
  const calls: any[] = [];
  return {
    calls,
    processes: {
      listLocal: () => [{ id: 'p1', name: 'build' }],
      localAction: async (id: string, action: string) => {
        calls.push(['process', id, action]);
        return { id, action };
      },
    },
    changes: {
      list: () => [{ id: 'c1' }],
      commit: async (id: string) => {
        calls.push(['commit', id]);
        return { committed: id };
      },
      rollback: async (id: string, options: any) => {
        calls.push(['rollback', id, options]);
        return { rolledBack: id };
      },
      rename: (id: string, name: string) => {
        calls.push(['rename', id, name]);
        return { renamed: name };
      },
    },
    metrics: { snapshot: () => [{ family: 'files.read' }] },
    audit: {
      verify: () => ({ valid: true }),
      exportJsonl: () => '{"seq":1}\n',
      exportJson: () => '[{"seq":1}]',
    },
  } as any;
}

const BASE = 'https://localhost';

test('operation routes list processes and run stop restart forget actions', async () => {
  const ctx = context();

  const listed = response();
  assert.equal(
    await handleOperationRoutes(request('GET'), listed, new URL(`${BASE}/api/processes`), ctx),
    true,
  );
  assert.deepEqual(JSON.parse(listed.body), [{ id: 'p1', name: 'build' }]);

  for (const action of ['stop', 'restart', 'forget']) {
    const res = response();
    assert.equal(
      await handleOperationRoutes(
        request('POST'),
        res,
        new URL(`${BASE}/api/processes/p1/${action}`),
        ctx,
      ),
      true,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).result.action, action);
  }
  assert.deepEqual(ctx.calls.slice(0, 3), [
    ['process', 'p1', 'stop'],
    ['process', 'p1', 'restart'],
    ['process', 'p1', 'forget'],
  ]);

  const extraSegment = response();
  assert.equal(
    await handleOperationRoutes(
      request('POST'),
      extraSegment,
      new URL(`${BASE}/api/processes/p1/stop/extra`),
      ctx,
    ),
    false,
  );
});

test('operation routes fall back to empty process and change lists without services', async () => {
  const emptyProcesses = response();
  assert.equal(
    await handleOperationRoutes(
      request('GET'),
      emptyProcesses,
      new URL(`${BASE}/api/processes`),
      {} as any,
    ),
    true,
  );
  assert.deepEqual(JSON.parse(emptyProcesses.body), []);

  const emptyChanges = response();
  assert.equal(
    await handleOperationRoutes(request('GET'), emptyChanges, new URL(`${BASE}/api/changes`), {
      changes: undefined,
    } as any),
    true,
  );
  assert.deepEqual(JSON.parse(emptyChanges.body), []);
});

test('operation routes commit rollback rename metrics audit verify and export', async () => {
  const ctx = context();

  const changesListed = response();
  assert.equal(
    await handleOperationRoutes(request('GET'), changesListed, new URL(`${BASE}/api/changes`), ctx),
    true,
  );
  assert.deepEqual(JSON.parse(changesListed.body), [{ id: 'c1' }]);

  const committed = response();
  assert.equal(
    await handleOperationRoutes(
      request('POST'),
      committed,
      new URL(`${BASE}/api/changes/c1/commit`),
      ctx,
    ),
    true,
  );
  assert.deepEqual(JSON.parse(committed.body).result, { committed: 'c1' });

  const forced = request('POST', { force: true, skipPaths: ['/keep'] });
  const forcedRes = response();
  assert.equal(
    await handleOperationRoutes(forced, forcedRes, new URL(`${BASE}/api/changes/c2/rollback`), ctx),
    true,
  );
  assert.deepEqual(ctx.calls.find((row: any) => row[0] === 'rollback')[2], {
    force: true,
    skipPaths: ['/keep'],
  });

  const loose = request('POST', { force: 'yes', skipPaths: 'not-an-array' });
  const looseRes = response();
  await handleOperationRoutes(loose, looseRes, new URL(`${BASE}/api/changes/c3/rollback`), ctx);
  assert.deepEqual(ctx.calls.filter((row: any) => row[0] === 'rollback').at(-1)[2], {
    force: true,
    skipPaths: [],
  });

  const renamed = response();
  assert.equal(
    await handleOperationRoutes(request('PATCH'), renamed, new URL(`${BASE}/api/changes/c1`), ctx),
    true,
  );
  assert.equal(renamed.statusCode, 200);

  const renamedNamed = request('PATCH', { name: 'release' });
  const renamedNamedRes = response();
  await handleOperationRoutes(
    renamedNamed,
    renamedNamedRes,
    new URL(`${BASE}/api/changes/c1`),
    ctx,
  );
  assert.deepEqual(ctx.calls.filter((row: any) => row[0] === 'rename').at(-1), [
    'rename',
    'c1',
    'release',
  ]);

  const metrics = response();
  assert.equal(
    await handleOperationRoutes(request('GET'), metrics, new URL(`${BASE}/api/metrics`), ctx),
    true,
  );
  assert.deepEqual(JSON.parse(metrics.body), [{ family: 'files.read' }]);
  const emptyMetrics = response();
  await handleOperationRoutes(
    request('GET'),
    emptyMetrics,
    new URL(`${BASE}/api/metrics`),
    {} as any,
  );
  assert.deepEqual(JSON.parse(emptyMetrics.body), []);

  const verified = response();
  assert.equal(
    await handleOperationRoutes(request('GET'), verified, new URL(`${BASE}/api/audit/verify`), ctx),
    true,
  );
  assert.deepEqual(JSON.parse(verified.body), { valid: true });
  const failedVerify = response();
  await handleOperationRoutes(
    request('GET'),
    failedVerify,
    new URL(`${BASE}/api/audit/verify`),
    {} as any,
  );
  assert.deepEqual(JSON.parse(failedVerify.body), { valid: false });

  const jsonl = response();
  assert.equal(
    await handleOperationRoutes(
      request('GET'),
      jsonl,
      new URL(`${BASE}/api/audit/export?format=jsonl`),
      ctx,
    ),
    true,
  );
  assert.equal(jsonl.contentType, 'application/x-ndjson');
  assert.equal(jsonl.body, '{"seq":1}\n');

  const json = response();
  assert.equal(
    await handleOperationRoutes(request('GET'), json, new URL(`${BASE}/api/audit/export`), ctx),
    true,
  );
  assert.deepEqual(JSON.parse(json.body), [{ seq: 1 }]);

  assert.equal(
    await handleOperationRoutes(
      request('GET'),
      response(),
      new URL(`${BASE}/api/audit/export?format=xml`),
      ctx,
    ),
    true,
  );
});

test('operation routes reject non-matching methods and unknown paths', async () => {
  const ctx = context();
  for (const [method, url] of [
    ['DELETE', `${BASE}/api/processes`],
    ['GET', `${BASE}/api/processes/p1/stop`],
    ['POST', `${BASE}/api/processes/p1/pause`],
    ['PATCH', `${BASE}/api/changes/c1/rename`],
    ['POST', `${BASE}/api/metrics`],
    ['GET', `${BASE}/api/unknown`],
  ] as const) {
    assert.equal(
      await handleOperationRoutes(request(method), response(), new URL(url), ctx),
      false,
    );
  }
});
