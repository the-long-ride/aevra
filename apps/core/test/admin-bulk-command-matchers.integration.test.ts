import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminServer } from '../src/admin/server.js';

async function request(server: AdminServer, body: any) {
  return fetch(`${server.url()}/api/permissions/bulk`, {
    method: 'POST',
    headers: {
      cookie: 'aevra_admin=keep-me',
      origin: server.url(),
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
const bootstrap = { validateSession: (value: string | undefined) => value === 'keep-me' } as any;
function sink() {
  const rules: any[] = [];
  return {
    rules,
    permissions: {
      upsert: (rule: any) => {
        rules.push(rule);
        return rule;
      },
      upsertMany: (batch: any[]) => {
        rules.push(...batch);
        return batch;
      },
    },
  };
}

test('expands file capabilities with wildcard and commands with each deduplicated matcher', async () => {
  const { rules, permissions } = sink();
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    api: { permissions } as any,
  });
  await server.start();
  const response = await request(server, {
    effect: 'allow',
    scope: 'global',
    actors: ['connector:ChatGPT'],
    capabilities: ['files.read', 'files.write', 'commands.run'],
    commandMatchers: [' git:status ', 'npm:test', 'git:status', ''],
  });
  assert.equal(response.status, 201);
  assert.deepEqual(
    rules.map((rule) => [rule.capability, rule.matcher]),
    [
      ['files.read', '*'],
      ['files.write', '*'],
      ['commands.run', 'git:status'],
      ['commands.run', 'npm:test'],
    ],
  );
  await server.close();
});

test('rejects an empty command matcher list before writing any rules', async () => {
  const { rules, permissions } = sink();
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    api: { permissions } as any,
  });
  await server.start();
  const response = await request(server, {
    effect: 'allow',
    scope: 'global',
    actors: ['connector:ChatGPT'],
    capabilities: ['files.read', 'commands.run'],
    commandMatchers: [' ', ''],
  });
  assert.equal(response.status, 400);
  assert.deepEqual(rules, []);
  assert.match(String(((await response.json()) as any).error.message), /command matcher/i);
  await server.close();
});

test('keeps legacy single matcher compatibility for command-only requests', async () => {
  const { rules, permissions } = sink();
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    api: { permissions } as any,
  });
  await server.start();
  const response = await request(server, {
    effect: 'allow',
    scope: 'global',
    actors: ['connector:ChatGPT'],
    capabilities: ['commands.run'],
    matcher: 'git:status',
  });
  assert.equal(response.status, 201);
  assert.equal(rules[0].matcher, 'git:status');
  await server.close();
});
