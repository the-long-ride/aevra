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
    async resourceRead(_sessionId: string, uri: string) {
      return { uri, contents: [{ uri, mimeType: 'text/markdown', text: 'skill body' }] };
    },
    promptsList() {
      return { prompts: [{ name: 'aevra-instructions', description: 'instructions' }] };
    },
    async promptGet() {
      return {
        description: 'instructions',
        messages: [{ role: 'user', content: { type: 'text', text: 'AGENTS' } }],
      };
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

test('one local approval unlocks all skill and instruction reads for one MCP session', async () => {
  const f = fixture();
  const session = f.sessions.create(f.identity);
  assert.deepEqual(
    f.gate.resourcesList(session.id),
    { resources: [] },
    'passive resource discovery must not reveal the local skill inventory or trigger approval',
  );
  assert.equal(f.approvals.list().length, 0);

  const first = (await f.gate.call(session.id, 'skills_list', {})) as any;
  assert.equal(first.status, 'approval_pending');
  assert.match(first.requestId, /^req_/);
  assert.equal(first.scope, 'session');
  assert.deepEqual(first.sources, ['user', 'workspace']);
  assert.equal(f.calls.length, 0, 'skill inventory must stay hidden before approval');

  const repeated = (await f.gate.call(session.id, 'skill_read', {
    source: 'user',
    name: 'demo',
  })) as any;
  assert.equal(repeated.requestId, first.requestId);
  assert.equal(
    f.approvals.list().filter((ticket) => ticket.operation.family === 'skills:read').length,
    1,
  );

  f.approvals.approve(first.requestId, 'once');
  const granted = (await f.gate.call(session.id, 'approval_wait', {
    requestId: first.requestId,
  })) as any;
  assert.equal(granted.status, 'skill_access_granted');
  assert.equal(granted.scope, 'session');
  assert.deepEqual(granted.sources, ['user', 'workspace']);

  const list = (await f.gate.call(session.id, 'skills_list', { query: 'demo' })) as any;
  assert.equal(list.name, 'skills_list');
  const read = (await f.gate.call(session.id, 'skill_read', {
    source: 'workspace',
    name: 'demo',
  })) as any;
  assert.equal(read.name, 'skill_read');
  const instructions = (await f.gate.call(session.id, 'instructions_read', {})) as any;
  assert.equal(instructions.name, 'instructions_read');
  assert.equal(
    f.approvals.list().filter((ticket) => ticket.operation.family === 'skills:read').length,
    1,
    'all skill reads in the session share the same approval',
  );
  assert.equal(f.gate.resourcesList(session.id).resources.length, 1);
  assert.equal(
    (await f.gate.resourceRead(session.id, 'aevra://skill/user/demo')).contents[0]?.text,
    'skill body',
  );
  assert.equal((await f.gate.promptGet(session.id)).messages[0]?.content.text, 'AGENTS');
  f.db.close();
});

test('a fresh MCP session requires a new local skills approval even for the same OAuth authorization', async () => {
  const f = fixture();
  const first = f.sessions.create(f.identity);
  const pending = (await f.gate.call(first.id, 'skills_list', {})) as any;
  f.approvals.approve(pending.requestId, 'once');
  await f.gate.call(first.id, 'approval_wait', { requestId: pending.requestId });
  f.sessions.disconnect(first.id);

  const second = f.sessions.create(f.identity);
  const next = (await f.gate.call(second.id, 'skills_list', {})) as any;
  assert.equal(next.status, 'approval_pending');
  assert.notEqual(next.requestId, pending.requestId);
  assert.equal(
    f.approvals.list().filter((ticket) => ticket.operation.family === 'skills:read').length,
    2,
  );
  f.db.close();
});

test('denying local skills access blocks the rest of that MCP session without repeated prompts', async () => {
  const f = fixture();
  const session = f.sessions.create(f.identity);
  const pending = (await f.gate.call(session.id, 'instructions_read', {})) as any;
  f.approvals.deny(pending.requestId);

  await assert.rejects(
    () => f.gate.call(session.id, 'skills_list', {}),
    (error: any) => error?.code === 'APPROVAL_DENIED',
  );
  await assert.rejects(
    () => f.gate.promptGet(session.id),
    (error: any) => error?.code === 'APPROVAL_DENIED',
  );
  assert.equal(
    f.approvals.list().filter((ticket) => ticket.operation.family === 'skills:read').length,
    1,
  );
  f.db.close();
});
