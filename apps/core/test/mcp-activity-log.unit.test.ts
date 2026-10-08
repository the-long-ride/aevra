import assert from 'node:assert/strict';
import test from 'node:test';
import { McpActivityLog } from '../src/mcp/activity-log.js';

const hiddenWords = 'synthetic hidden words';

test('MCP activity log updates one operation through its lifecycle', () => {
  const log = new McpActivityLog(10);
  const seen: string[] = [];
  const unsubscribe = log.subscribe((entry) => seen.push(`${entry.id}:${entry.state}`));

  const started = log.begin({
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    workspaceId: 'ws_old',
    kind: 'tool',
    action: 'workspace_select',
  });
  const finished = log.finish(started.id, 'success', 18, 'ws_new');

  assert.equal(finished?.id, started.id);
  assert.equal(finished?.state, 'success');
  assert.equal(finished?.durationMs, 18);
  assert.equal(finished?.workspaceId, 'ws_new');
  assert.deepEqual(seen, [`${started.id}:running`, `${started.id}:success`]);
  assert.equal(log.recent().length, 1);
  assert.equal(log.recent()[0]?.state, 'success');
  unsubscribe();
});

test('MCP activity log keeps only the newest bounded entries', () => {
  const log = new McpActivityLog(2);
  log.instant({ actor: 'oauth:A', sessionId: 's1', kind: 'rpc', action: 'tools/list' });
  log.instant({ actor: 'oauth:B', sessionId: 's2', kind: 'rpc', action: 'resources/list' });
  log.instant({ actor: 'oauth:C', sessionId: 's3', kind: 'session', action: 'initialize' });

  const entries = log.recent();
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.actor),
    ['oauth:B', 'oauth:C'],
  );
});

test('MCP activity details are sanitized and bounded before entering the activity stream', () => {
  const log = new McpActivityLog(10);
  const started = log.begin({
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    kind: 'tool',
    action: 'file_read',
    input: { path: 'README.md', password: hiddenWords },
  });
  const finished = log.finish(started.id, 'success', 12, undefined, {
    content: 'sensitive file contents',
    message: 'x'.repeat(20_000),
  });

  assert.match(started.input ?? '', /README\.md/);
  assert.equal((started.input ?? '').includes(hiddenWords), false);
  assert.match(started.input ?? '', /\[REDACTED\]/);
  assert.equal((finished?.output ?? '').includes('sensitive file contents'), false);
  assert.match(finished?.output ?? '', /\[REDACTED\]/);
  assert.ok((finished?.output?.length ?? 0) < 13_000);
});

test('activity redacts copies of secrets discovered beyond clone limits', () => {
  const fillers = Object.fromEntries(Array.from({ length: 210 }, (_, i) => [`k${i}`, i]));
  const values = [
    { message: 'short-password', ...fillers, password: 'short-password' },
    { message: 'short-password', items: [...Array(50).fill(null), { password: 'short-password' }] },
  ];
  for (const input of values) {
    const log = new McpActivityLog();
    const started = log.begin({ actor: 'a', sessionId: 's', kind: 'tool', action: 'x', input });
    const finished = log.finish(started.id, 'success', 0, undefined, input);
    assert.ok(!started.input?.includes('short-password'));
    assert.ok(!finished?.output?.includes('short-password'));
    assert.match(started.input ?? '', /REDACTED/);
  }
});
