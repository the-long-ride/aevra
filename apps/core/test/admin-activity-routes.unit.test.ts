import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { handleActivityRoutes } from '../src/admin/routes/activity-routes.js';
import { McpActivityLog } from '../src/mcp/activity-log.js';

test('activity SSE route sends recent rows, streams updates, and unsubscribes on close', async () => {
  const activity = new McpActivityLog(10);
  activity.instant({
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    kind: 'session',
    action: 'initialize',
  });

  const req = new EventEmitter() as any;
  req.method = 'GET';
  const headers = new Map<string, string>();
  const chunks: string[] = [];
  const res = {
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), String(value));
    },
    flushHeaders() {},
    write(value: unknown) {
      chunks.push(String(value));
      return true;
    },
    end() {},
  } as any;

  const handled = await handleActivityRoutes(
    req,
    res,
    new URL('https://localhost/api/activity/stream'),
    { activity },
  );

  assert.equal(handled, true);
  assert.equal(headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.match(chunks.join(''), /event: activity/);
  assert.match(chunks.join(''), /oauth:ChatGPT/);

  activity.instant({
    actor: 'oauth:Claude',
    sessionId: 'ses_2',
    kind: 'rpc',
    action: 'tools/list',
  });
  assert.match(chunks.join(''), /oauth:Claude/);

  req.emit('close');
  const countAfterClose = chunks.length;
  activity.instant({
    actor: 'oauth:Gemini',
    sessionId: 'ses_3',
    kind: 'rpc',
    action: 'resources/list',
  });
  assert.equal(chunks.length, countAfterClose);
});

test('GET /api/activity returns recent activity log entries as JSON', async () => {
  const activity = new McpActivityLog(10);
  activity.instant({
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    kind: 'session',
    action: 'initialize',
  });

  const req = {} as any;
  req.method = 'GET';
  let body = '';
  const headers = new Map<string, string>();
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    end(content?: string) {
      if (content) body = content;
    },
  } as any;

  const handled = await handleActivityRoutes(req, res, new URL('https://localhost/api/activity'), {
    activity,
  });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(body);
  assert.equal(Array.isArray(data), true);
  assert.equal(data.length, 1);
  assert.equal(data[0].actor, 'oauth:ChatGPT');
});
