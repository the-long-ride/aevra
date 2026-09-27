import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ApprovalRepository } from '../../../packages/store/src/approvals.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { AuditService } from '../../../apps/core/src/audit/audit-service.js';
import { ApprovalService } from '../../../apps/core/src/approvals/approval-service.js';
import { resumeApproval } from '../src/approval-resume.js';
import { handleBrowserTool } from '../src/browser-tools.js';
import { handleDesktopTool } from '../src/desktop-tools.js';
import { browserContext } from './browser-context.js';
import { desktopContext } from './desktop-context.js';

function approvalsFor(context: any) {
  const db = AevraDatabase.open(':memory:');
  const approvals = new ApprovalService(
    new ApprovalRepository(db.raw()),
    new AuditService(new AuditRepository(db.raw())),
    { fastWaitMs: 0, lifetimeMs: 300_000, lifetimeByRiskMs: {} },
  );
  context.approvals = approvals;
  context.deps.hostControlApproval = { canResume: () => true };
  return { db, approvals };
}

test('an approved browser action does not authorize another concurrent same-family call', async () => {
  const fixture = browserContext();
  const context = fixture.value;
  const { db, approvals } = approvalsFor(context);
  let release!: () => void;
  let entered!: () => void;
  const enteredWorker = new Promise<void>((resolve) => (entered = resolve));
  const heldWorker = new Promise<void>((resolve) => (release = resolve));
  const originalExecute = fixture.worker.execute;
  fixture.worker.execute = async (input: any) => {
    if (input.operation.kind === 'browser.act') {
      fixture.worker.calls.push(input);
      entered();
      await heldWorker;
      return { ok: true, value: [{ op: 'click', ok: true }] };
    }
    return originalExecute(input);
  };
  context.callInner = (sessionId: string, name: string, args: any, proof: any) =>
    handleBrowserTool({ ...context, hostApprovalProof: proof }, sessionId, name, args);

  try {
    const first: any = await handleBrowserTool(context, 's1', 'browser_act_many', {
      actions: [{ op: 'click', selector: '#first' }],
    });
    assert.equal(first.status, 'approval_pending');
    approvals.approve(first.requestId);
    const resumed = resumeApproval(context, 's1', first.requestId);
    await Promise.race([
      enteredWorker,
      resumed.then(() => {
        throw new Error('Approved action finished before reaching worker');
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Approved action never reached worker')), 3000),
      ),
    ]);
    const secondPromise = handleBrowserTool(context, 's1', 'browser_act_many', {
      actions: [{ op: 'click', selector: '#second' }],
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
      fixture.worker.calls.filter((call: any) => call.operation.kind === 'browser.act').length,
      1,
    );
    release();
    const second: any = await secondPromise;
    assert.equal(second.status, 'approval_pending');
    await resumed;
  } finally {
    release?.();
    db.close();
  }
});

test('approved desktop content replays exactly but stays out of the approval row', async () => {
  for (const [name, args, field] of [
    ['desktop_type', { text: 'private typed content' }, 'text'],
    ['desktop_key', { keys: 'Control+V' }, 'keys'],
    [
      'desktop_set_value',
      {
        windowId: 'w1',
        windowLeaseId: 'lease-1',
        snapshotId: 'snap-1',
        ref: 'ref_1_1',
        value: 'private field content',
      },
      'value',
    ],
  ] as const) {
    const fixture = desktopContext();
    const context = fixture.value;
    const { db, approvals } = approvalsFor(context);
    context.callInner = (sessionId: string, tool: string, replayArgs: any, proof: any) =>
      handleDesktopTool({ ...context, hostApprovalProof: proof }, sessionId, tool, replayArgs);
    try {
      const pending: any = await handleDesktopTool(context, 's1', name, { ...args });
      assert.equal(pending.status, 'approval_pending');
      const stored = db
        .raw()
        .prepare('SELECT operation_json FROM pending_approvals WHERE id=?')
        .get(pending.requestId) as { operation_json: string };
      assert.equal(stored.operation_json.includes(args[field] as string), false);
      approvals.approve(pending.requestId);
      const resumed = await resumeApproval(context, 's1', pending.requestId);
      const operation = fixture.worker.calls.at(-1)?.operation;
      assert.ok(
        operation,
        `${name}: ${JSON.stringify({ resumed, tickets: approvals.list().map((ticket) => ({ payload: ticket.payload, hash: ticket.operation.argsHash })) })}`,
      );
      assert.equal(
        name === 'desktop_set_value' ? operation.action.value : operation[field],
        args[field],
      );
    } finally {
      db.close();
    }
  }
});

test('approved desktop content fails closed when its in-memory payload is lost', async () => {
  const fixture = desktopContext();
  const context = fixture.value;
  const { db, approvals } = approvalsFor(context);
  context.callInner = (sessionId: string, tool: string, replayArgs: any, proof: any) =>
    handleDesktopTool({ ...context, hostApprovalProof: proof }, sessionId, tool, replayArgs);
  try {
    const pending: any = await handleDesktopTool(context, 's1', 'desktop_type', {
      text: 'must not become empty',
    });
    approvals.approve(pending.requestId);
    context.approvals = new ApprovalService(
      new ApprovalRepository(db.raw()),
      new AuditService(new AuditRepository(db.raw())),
      { fastWaitMs: 0, lifetimeMs: 300_000, lifetimeByRiskMs: {} },
    );
    await assert.rejects(resumeApproval(context, 's1', pending.requestId), {
      code: 'APPROVAL_CONTEXT_CHANGED',
    });
    assert.equal(
      fixture.worker.calls.some((call: any) => call.operation.kind === 'desktop.type'),
      false,
    );
  } finally {
    db.close();
  }
});

test('browser approval with implicit target never follows a newly active tab', async () => {
  const fixture = browserContext();
  const context = fixture.value;
  const { db, approvals } = approvalsFor(context);
  let active = 'a';
  fixture.worker.execute = async (input: any) => {
    fixture.worker.calls.push(input);
    const tabs = [
      { tabId: 'a', url: 'https://example.com/a', active: active === 'a' },
      { tabId: 'b', url: 'https://example.com/b', active: active === 'b' },
    ];
    if (input.operation.kind === 'browser.tabs') return { ok: true, value: tabs };
    if (input.operation.kind === 'browser.status')
      return {
        ok: true,
        value: { connected: true, transport: 'extension', attachmentId: 'peer-1', tabs },
      };
    return { ok: true, value: [] };
  };
  context.callInner = (sessionId: string, name: string, args: any, proof: any) =>
    handleBrowserTool({ ...context, hostApprovalProof: proof }, sessionId, name, args);
  try {
    const pending: any = await handleBrowserTool(context, 's1', 'browser_act_many', {
      actions: [{ op: 'click', selector: '#approved' }],
    });
    approvals.approve(pending.requestId);
    active = 'b';
    await resumeApproval(context, 's1', pending.requestId);
    const acted = fixture.worker.calls.find((call: any) => call.operation.kind === 'browser.act');
    assert.equal(acted?.operation.tabId, 'a');
  } finally {
    db.close();
  }
});

test('browser approval rejects navigation of its frozen tab before replay', async () => {
  const fixture = browserContext();
  const context = fixture.value;
  const { db, approvals } = approvalsFor(context);
  let url = 'https://example.com/first';
  fixture.worker.execute = async (input: any) => {
    fixture.worker.calls.push(input);
    const tabs = [{ tabId: 'a', url, active: true }];
    if (input.operation.kind === 'browser.tabs') return { ok: true, value: tabs };
    if (input.operation.kind === 'browser.status')
      return {
        ok: true,
        value: {
          connected: true,
          transport: 'extension',
          attachmentId: 'peer-1',
          tabs: [{ tabId: 'a', url: 'https://example.com/first', active: true }],
        },
      };
    return { ok: true, value: [] };
  };
  context.callInner = (sessionId: string, name: string, args: any, proof: any) =>
    handleBrowserTool({ ...context, hostApprovalProof: proof }, sessionId, name, args);
  try {
    const pending: any = await handleBrowserTool(context, 's1', 'browser_act_many', {
      actions: [{ op: 'click', selector: '#approved' }],
    });
    approvals.approve(pending.requestId);
    url = 'https://example.com/second';
    await assert.rejects(resumeApproval(context, 's1', pending.requestId), {
      code: 'APPROVAL_CONTEXT_CHANGED',
    });
    assert.equal(
      fixture.worker.calls.some((call: any) => call.operation.kind === 'browser.act'),
      false,
    );
  } finally {
    db.close();
  }
});
