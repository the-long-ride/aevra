import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../store/src/database.js';
import { SessionRepository } from '../../store/src/sessions.js';
import { ApprovalRepository } from '../../store/src/approvals.js';
import { AuditRepository } from '../../store/src/audit.js';
import { CapabilityProfileService } from '../../../apps/core/src/policy/capabilities.js';
import { SessionManager } from '../../../apps/core/src/sessions/session-manager.js';
import { ApprovalService } from '../../../apps/core/src/approvals/approval-service.js';
import { AuditService } from '../../../apps/core/src/audit/audit-service.js';
import { SessionSkillAccessGate } from '../src/skill-access-gate.js';

function fixture() {
  const db = AevraDatabase.open(':memory:');
  const sessions = new SessionManager(
    new SessionRepository(db.raw()),
    new CapabilityProfileService(db.raw()),
  );
  const approvals = new ApprovalService(
    new ApprovalRepository(db.raw()),
    new AuditService(new AuditRepository(db.raw())),
    { fastWaitMs: 0, lifetimeMs: 60_000, lifetimeByRiskMs: {} },
  );
  const calls: Array<{ sessionId: string; name: string; args: any }> = [];
  const inner = {
    async call(sessionId: string, name: string, args: any = {}) {
      calls.push({ sessionId, name, args });
      if (name === 'skill_read')
        return { skill: { name: args.name, source: args.source }, content: 'skill body', files: [] };
      if (name === 'instructions_read')
        return { instructions: [{ source: 'user', content: 'AGENTS' }] };
      return { name, args };
    },
    resourcesList() {
      return {
        resources: [
          {
            uri: 'aevra://skill/user/demo',
            name: 'demo',
            description: 'demo',
            mimeType: 'text/markdown',
          },
        ],
      };
    },
    promptsList() {
      return { prompts: [{ name: 'aevra-instructions', description: 'instructions' }] };
    },
  };
  const gate = new SessionSkillAccessGate(inner as any, sessions, approvals);
  const identity = {
    actor: 'oauth:ChatGPT',
    subject: 'oauth_grant_one',
    issuer: 'https://example.test',
    audience: 'https://example.test/mcp',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  return { db, sessions, approvals, calls, gate, identity };
}

test('skill and instruction tools use capability-aware handlers when a workspace lease exists', async () => {
  const f = fixture();
  const session = f.sessions.create(f.identity);
  assert.equal(f.sessions.admitWorkspace(session.id, 'workspace', 'read-only').status, 'admitted');
  for (const [name, args] of [
    ['skills_list', {}],
    ['skill_read', { source: 'user', name: 'demo' }],
    ['skill_write', { source: 'user', name: 'demo', content: 'x' }],
    ['instructions_read', {}],
    ['instructions_write', { source: 'user', content: 'x' }],
  ] as const) {
    await f.gate.call(session.id, name, args);
    assert.equal(f.calls.at(-1)?.name, name);
  }
  assert.equal(f.approvals.list().length, 0, 'tool permission is owned by the inner capability gate');
  f.db.close();
});

test('skill read tools keep session approval compatibility before workspace selection', async () => {
  const f = fixture();
  const session = f.sessions.create(f.identity);
  const pending = (await f.gate.call(session.id, 'skills_list', {})) as any;
  assert.equal(pending.status, 'approval_pending');
  assert.equal(f.calls.length, 0);
  const ticket = f.approvals.status(pending.requestId)!;
  assert.equal(ticket.operation.capability, 'skills.read');
  f.approvals.approve(ticket.id, 'once');
  await f.gate.call(session.id, 'approval_wait', { requestId: ticket.id });
  const result = await f.gate.call(session.id, 'skills_list', {});
  assert.equal(result.name, 'skills_list');
  f.db.close();
});

test('one local approval unlocks passive resources but actual reads still use dedicated tools', async () => {
  const f = fixture();
  const session = f.sessions.create(f.identity);
  assert.deepEqual(
    f.gate.resourcesList(session.id),
    { resources: [] },
    'passive resource discovery must not reveal the local skill inventory or trigger approval',
  );
  assert.equal(f.approvals.list().length, 0);

  await assert.rejects(
    () => f.gate.resourceRead(session.id, 'aevra://skill/user/demo'),
    (error: any) => error?.code === 'APPROVAL_PENDING',
  );
  const pending = f.approvals.list().find((ticket) => ticket.operation.family === 'skills:read');
  assert.ok(pending);
  assert.equal(pending.operation.capability, 'skills.read');

  f.approvals.approve(pending.id, 'once');
  const granted = (await f.gate.call(session.id, 'approval_wait', { requestId: pending.id })) as any;
  assert.equal(granted.status, 'skill_access_granted');
  assert.equal(f.gate.resourcesList(session.id).resources.length, 1);
  assert.equal(
    (await f.gate.resourceRead(session.id, 'aevra://skill/user/demo')).contents[0]?.text,
    'skill body',
  );
  assert.equal(f.calls.at(-1)?.name, 'skill_read');
  assert.equal((await f.gate.promptGet(session.id)).messages[0]?.content.text, '# user instructions\n\nAGENTS');
  assert.equal(f.calls.at(-1)?.name, 'instructions_read');
  f.db.close();
});

test('a fresh MCP session requires a new passive resource approval', async () => {
  const f = fixture();
  const first = f.sessions.create(f.identity);
  await assert.rejects(() => f.gate.resourceRead(first.id, 'aevra://skill/user/demo'));
  const pending = f.approvals.list()[0]!;
  f.approvals.approve(pending.id, 'once');
  await f.gate.call(first.id, 'approval_wait', { requestId: pending.id });
  f.sessions.disconnect(first.id);

  const second = f.sessions.create(f.identity);
  await assert.rejects(
    () => f.gate.resourceRead(second.id, 'aevra://skill/user/demo'),
    (error: any) => error?.code === 'APPROVAL_PENDING',
  );
  assert.equal(
    f.approvals.list().filter((ticket) => ticket.operation.family === 'skills:read').length,
    2,
  );
  f.db.close();
});
