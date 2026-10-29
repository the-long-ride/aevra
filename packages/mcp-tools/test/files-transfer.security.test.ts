import assert from 'node:assert/strict';
import test from 'node:test';
import { McpActivityLog } from '../../../apps/core/src/mcp/activity-log.js';
import { b64, makeHarness } from './transfer-harness.js';

const HEADER_VALUE = 'sample header value';
const BODY_TEXT = 'private body text for the transfer test';
const BODY_B64 = b64(BODY_TEXT);

const args = () => ({
  workspaceId: 'w1',
  entries: [
    { path: '/in/a.txt', mimeType: 'text/plain', content: BODY_B64, encoding: 'base64' },
    {
      path: '/in/b.txt',
      mimeType: 'text/plain',
      url: 'https://files.example/b.txt?signature=sample-query-value',
      headers: { 'x-sample-header': HEADER_VALUE },
    },
  ],
});

function leaks(text: string) {
  return [BODY_B64, HEADER_VALUE, 'sample-query-value'].filter((needle) => text.includes(needle));
}

function storedText(h: ReturnType<typeof makeHarness>) {
  const tickets = h.db.raw().prepare('SELECT operation_json FROM pending_approvals').all() as any[];
  const audit = h.db.raw().prepare('SELECT event_json FROM audit_events').all() as any[];
  return [
    ...tickets.map((r) => String(r.operation_json)),
    ...audit.map((r) => String(r.event_json)),
    JSON.stringify(h.approvals.list()),
  ].join('\n');
}

test('headers never persisted: ticket, audit, activity log, hook payload and result', async () => {
  const h = makeHarness({ hook: true });
  try {
    const pending: any = await h.service.call('s1', 'files_download', args());
    assert.equal(pending.status, 'approval_pending');
    assert.deepEqual(leaks(JSON.stringify(pending)), []);
    assert.deepEqual(leaks(storedText(h)), []);
    assert.match(storedText(h), /files\.example/);

    h.approvals.approve(pending.requestId, 'once');
    const done: any = await h.service.call('s1', 'approval_wait', { requestId: pending.requestId });
    assert.equal(done.succeeded, 2);
    assert.deepEqual(leaks(JSON.stringify(done)), []);
    assert.deepEqual(leaks(storedText(h)), []);
    assert.equal(h.files.get('/in/a.txt')!.toString(), BODY_TEXT);
    const urlOp = h.ops.find((op) => op.source?.type === 'url');
    assert.equal(urlOp.source.headers['x-sample-header'], HEADER_VALUE);

    assert.ok(h.hookPayloads.length >= 1);
    assert.deepEqual(leaks(JSON.stringify(h.hookPayloads)), []);

    const log = new McpActivityLog(10);
    const entry = log.begin({
      actor: 'a',
      sessionId: 's1',
      kind: 'tool',
      action: 'files_download',
      input: args(),
    });
    log.finish(entry.id, 'success', 1, undefined, done);
    assert.deepEqual(leaks(JSON.stringify(log.recent())), []);
  } finally {
    h.close();
  }
});

test('the approval ticket carries only path, source kind, host and size', async () => {
  const h = makeHarness();
  try {
    const pending: any = await h.service.call('s1', 'files_download', args());
    const ticket: any = h.approvals.status(pending.requestId);
    const transfer = ticket.payload.transfer;
    assert.equal(transfer.entries[0].path, '/in/a.txt');
    assert.equal(transfer.entries[0].source, 'inline');
    assert.equal(transfer.entries[0].bytes, BODY_TEXT.length);
    assert.equal(transfer.entries[1].source, 'url');
    assert.equal(transfer.entries[1].host, 'files.example');
    assert.equal(transfer.headersSupplied, 1);
    assert.equal(ticket.payload.securityOnce, true);
  } finally {
    h.close();
  }
});

test('a denied approval writes nothing and drops the volatile bytes', async () => {
  const h = makeHarness();
  try {
    const pending: any = await h.service.call('s1', 'files_download', args());
    h.approvals.deny(pending.requestId);
    const outcome: any = await h.service.call('s1', 'approval_wait', {
      requestId: pending.requestId,
    });
    assert.equal(outcome.state, 'DENIED');
    assert.equal(outcome.ok, undefined);
    assert.equal(h.files.size, 0);
  } finally {
    h.close();
  }
});

test('executed transfers are audited by count, never by content', async () => {
  const h = makeHarness({ yolo: 'do-whatever' });
  try {
    await h.service.call('s1', 'files_download', args());
    const rows = h.db.raw().prepare('SELECT event_json FROM audit_events').all() as any[];
    const events = rows.map((r) => JSON.parse(String(r.event_json)));
    const transfer = events.find((e) => e.operation === 'files:transfer');
    assert.ok(transfer);
    assert.match(String(transfer.result), /2\/2/);
    assert.deepEqual(leaks(JSON.stringify(rows)), []);
  } finally {
    h.close();
  }
});
