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
  const calls: string[] = [];
  const inner = {
    async call(_sessionId: string, name: string, args: any = {}) {
      calls.push(name);
      if (name === 'skill_read') {
        return {
          skill: { name: args.name, source: args.source },
          content: 'workspace skill',
          files: [],
        };
      }
      if (name === 'instructions_read') {
        return { instructions: [{ source: 'workspace', content: 'workspace rules' }] };
      }
      return { name, args };
    },
    resourcesList() {
      return {
        resources: [
          {
            uri: 'aevra://skill/workspace/demo',
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
  return {
    db,
    sessions,
    approvals,
    calls,
    gate: new SessionSkillAccessGate(inner as any, sessions, approvals),
  };
}

test('read-only workspace capability unlocks passive skill discovery without legacy session approval', async () => {
  const f = fixture();
  const session = f.sessions.create({
    actor: 'oauth:ChatGPT',
    subject: 'grant-workspace',
    issuer: 'https://example.test',
    audience: 'https://example.test/mcp',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(f.sessions.admitWorkspace(session.id, 'workspace', 'read-only').status, 'admitted');

  assert.equal(f.gate.resourcesList(session.id).resources.length, 1);
  assert.equal(f.approvals.list().length, 0);

  const resource = await f.gate.resourceRead(session.id, 'aevra://skill/workspace/demo');
  assert.equal(resource.contents[0]?.text, 'workspace skill');
  assert.equal(f.calls.at(-1), 'skill_read');
  assert.equal(f.approvals.list().length, 0);

  const prompt = await f.gate.promptGet(session.id);
  assert.match(prompt.messages[0]?.content.text ?? '', /workspace rules/);
  assert.equal(f.calls.at(-1), 'instructions_read');
  assert.equal(f.approvals.list().length, 0);
  f.db.close();
});
