import assert from 'node:assert/strict';
import test from 'node:test';
import { isApprovalTicket, summariseTicket } from '../src/result-shaper/approval.js';
import { shapeToolResult } from '../src/result-shaper/shape.js';

const ticket = {
  id: 'approval-1',
  state: 'PENDING',
  risk: 'HIGH',
  capability: 'shell.run',
  tool: 'shell_run',
  workspaceId: 'ws-1',
  expiresAt: '2026-10-07T12:00:00.000Z',
  createdAt: '2026-10-07T11:55:00.000Z',
  decision: null,
  operation: { summary: 'run build'.padEnd(400, '!'), args: { command: 'x'.repeat(2000) } },
  audit: { events: Array.from({ length: 20 }, (_, i) => ({ i })) },
};

test('isApprovalTicket needs id, state and an operation object', () => {
  assert.equal(isApprovalTicket(ticket), true);
  assert.equal(isApprovalTicket({ id: 'a', state: 'x' }), false);
  assert.equal(isApprovalTicket({ exitCode: 0, stdout: '' }), false);
});

test('summariseTicket keeps decision fields and a capped summary', () => {
  const summary = summariseTicket(ticket) as any;
  assert.equal(summary.id, 'approval-1');
  assert.equal(summary.state, 'PENDING');
  assert.equal(summary.risk, 'HIGH');
  assert.equal(summary.expiresAt, ticket.expiresAt);
  assert.ok(summary.summary.length <= 200);
  assert.equal(summary.operation, undefined);
  assert.equal(summary.audit, undefined);
});

test('approval tools return a summary unless detail is full', () => {
  const summary = shapeToolResult('approval_status', {}, ticket);
  assert.equal((summary.data as any).operation, undefined);
  assert.ok(summary.savedChars > 1000);
  const full = shapeToolResult('approval_status', { detail: 'full' }, ticket);
  assert.equal(full.data, ticket);
  assert.equal(full.savedChars, 0);
});

test('an approval_wait that finished a command is shaped like a command result', () => {
  const done = {
    ok: true,
    value: { exitCode: 0, signal: null, stdout: 'ok\r\n', stderr: '', durationMs: 3 },
  };
  const shaped = shapeToolResult('approval_wait', {}, done);
  assert.deepEqual(shaped.data, { exitCode: 0, stdout: 'ok\n', durationMs: 3 });
  assert.ok(shaped.savedChars > 0);
});

test('shell_run output honours maxOutputChars', () => {
  const data = { exitCode: 0, signal: null, stdout: 'q'.repeat(10_000), stderr: '', durationMs: 1 };
  const shaped = shapeToolResult('shell_run', { maxOutputChars: 1000 }, data);
  assert.equal((shaped.data as any).truncated, true);
  assert.ok(JSON.stringify(shaped.data).length < 1300);
});

test('batch results are shaped for any tool', () => {
  const data = {
    ok: true,
    count: 1,
    succeeded: 1,
    failed: 0,
    skipped: 0,
    results: [{ index: 0, ok: true, value: { path: '/x' } }],
  };
  const shaped = shapeToolResult('file_list', {}, data);
  assert.equal((shaped.data as any).results[0].index, undefined);
});

test('unrelated results pass through untouched', () => {
  const data = { entries: [1, 2, 3] };
  const shaped = shapeToolResult('file_list', {}, data);
  assert.equal(shaped.data, data);
  assert.equal(shaped.savedChars, 0);
});

test('a shaper failure returns the original result', () => {
  const hostile = {
    get id(): string {
      throw new Error('boom');
    },
    state: 'x',
    operation: {},
  };
  const shaped = shapeToolResult('approval_status', {}, hostile);
  assert.equal(shaped.data, hostile);
  assert.equal(shaped.savedChars, 0);
});

test('saved tokens use Unicode weights instead of dividing UTF-16 characters by four', () => {
  for (const char of ['界', '한', 'Ａ', '😀']) {
    const shaped = shapeToolResult(
      'command_run',
      { maxOutputChars: 1000 },
      {
        exitCode: 0,
        stdout: char.repeat(13000),
      },
    );
    const saved = (shaped as any).savedTokens;
    assert.ok(saved > (char.length === 2 ? 12480 : 11980));
    assert.ok(saved <= 13000);
  }
});
