import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AevraDatabase } from '../../store/src/database.js';
import { WorkspaceRepository } from '../../store/src/workspaces.js';
import { SessionRepository } from '../../store/src/sessions.js';
import { ApprovalRepository } from '../../store/src/approvals.js';
import { AuditRepository } from '../../store/src/audit.js';
import { PermissionRepository } from '../../store/src/permissions.js';
import { WorkspaceService } from '../../../apps/core/src/workspaces/workspace-service.js';
import { CapabilityProfileService } from '../../../apps/core/src/policy/capabilities.js';
import { PermissionEngine } from '../../../apps/core/src/policy/permissions.js';
import { SessionManager } from '../../../apps/core/src/sessions/session-manager.js';
import { ReadVersionCache } from '../../../apps/core/src/operations/read-version-cache.js';
import { ApprovalService } from '../../../apps/core/src/approvals/approval-service.js';
import { AuditService } from '../../../apps/core/src/audit/audit-service.js';
import { SkillsService } from '../../../apps/core/src/skills/skills-service.js';
import { McpToolService } from '../src/service.js';

function make() {
  const db = AevraDatabase.open(':memory:');
  const workspaces = new WorkspaceService(new WorkspaceRepository(db.raw()));
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'aevra-cap-'));
  const userHome = mkdtempSync(path.join(os.tmpdir(), 'aevra-cap-home-'));
  const workspace = workspaces.create({
    name: 'Aevra',
    hostRoot: workspaceRoot,
  });
  mkdirSync(path.join(workspaceRoot, '.agents', 'skills', 'demo'), { recursive: true });
  writeFileSync(path.join(workspaceRoot, '.agents', 'skills', 'demo', 'SKILL.md'), '# Demo');
  const profiles = new CapabilityProfileService(db.raw());
  const sessions = new SessionManager(new SessionRepository(db.raw()), profiles);
  const approvals = new ApprovalService(
    new ApprovalRepository(db.raw()),
    new AuditService(new AuditRepository(db.raw())),
    { fastWaitMs: 0, lifetimeMs: 60_000, lifetimeByRiskMs: {} },
  );
  approvals.setSessionIdentityResolver((id) => sessions.connectionIdentity(id));
  const permissionRepo = new PermissionRepository(db.raw()),
    permissions = new PermissionEngine(permissionRepo);
  const writes: any[] = [];
  const operations: any = {
    write: async (sessionId: string, input: any, authorization: any) => {
      writes.push({ sessionId, input, authorization });
      return { path: input.path, hash: 'sha256:test' };
    },
    runCommand: async () => ({
      ok: true,
      value: { exitCode: 0, signal: null, stdout: 'ok', stderr: '', durationMs: 1 },
    }),
    classify: (tokens: string[]) => ({
      family: tokens[0] === 'git' ? 'git:status' : 'npm:test',
      effect: 'BUILD_OUTPUT',
      risk: 'LOW',
      outputKeys: [],
    }),
  };
  const service = new McpToolService(
    sessions,
    workspaces,
    { execute: async () => ({ ok: true, value: {} }) } as any,
    new ReadVersionCache(),
    approvals,
    { approvals, operations, permissions, skills: new SkillsService(userHome) },
  );
  return {
    db,
    workspace,
    workspaceRoot,
    profiles,
    sessions,
    approvals,
    service,
    writes,
    permissionRepo,
  };
}
function identity(actor: string, subject: string) {
  return {
    actor,
    subject,
    issuer: 'https://example.test',
    audience: 'https://example.test/mcp',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}
async function readOnlySession(x: ReturnType<typeof make>, actor: string, subject: string) {
  x.profiles.mapActor(actor, x.workspace.id, 'read-only', 'auto');
  const s = x.sessions.create(identity(actor, subject));
  const admission = await x.sessions.switchWorkspace(s.id, x.workspace.id);
  assert.equal(admission.status, 'admitted');
  return s;
}

test('remembered files.write rule is effective without broadening the baseline profile', async () => {
  const x = make();
  const s = await readOnlySession(x, 'connector:ChatGPT', 'conn-a');
  x.permissionRepo.upsert({
    id: 'write',
    effect: 'allow',
    capability: 'files.write',
    scope: 'workspace',
    workspaceId: x.workspace.id,
    actor: 'connector:ChatGPT',
    matcher: '*',
    createdAt: new Date().toISOString(),
  });
  const status: any = await x.service.call(s.id, 'aevra_status');
  assert.deepEqual(status.baselineCapabilities.sort(), [
    'files.read',
    'files.search',
    'git.read',
    'instructions.read',
    'skills.read',
  ]);
  assert.ok(status.effectiveCapabilities.includes('files.write'));
  assert.deepEqual(status.capabilities, status.effectiveCapabilities);
  await x.service.call(s.id, 'file_write', { path: '/a.txt', content: 'hello' });
  assert.equal(x.writes.length, 1);
  assert.equal(x.writes[0].authorization.capability, 'files.write');
  assert.ok(
    !x.sessions.activeLease(s.id)?.capabilities.includes('files.write'),
    'baseline lease must stay read-only',
  );
  x.db.close();
});

test('files.write never authorizes skill_write or instructions_write', async () => {
  const x = make();
  const s = await readOnlySession(x, 'connector:ChatGPT', 'conn-skill-separation');
  x.permissionRepo.upsert({
    id: 'file-write-only',
    effect: 'allow',
    capability: 'files.write',
    scope: 'workspace',
    workspaceId: x.workspace.id,
    actor: 'connector:ChatGPT',
    matcher: '*',
    createdAt: new Date().toISOString(),
  });

  const skillBlocked: any = await x.service.call(s.id, 'skill_write', {
    source: 'workspace',
    name: 'demo',
    content: '# Changed',
  });
  assert.equal(skillBlocked.status, 'approval_pending');
  assert.equal(x.approvals.status(skillBlocked.requestId)!.operation.capability, 'skills.write');

  const instructionBlocked: any = await x.service.call(s.id, 'instructions_write', {
    source: 'workspace',
    content: 'rules',
  });
  assert.equal(instructionBlocked.status, 'approval_pending');
  assert.equal(
    x.approvals.status(instructionBlocked.requestId)!.operation.capability,
    'instructions.write',
  );
  x.db.close();
});

test('dedicated skill and instruction write rules authorize only their bounded targets', async () => {
  const x = make();
  const actor = 'connector:Claude';
  const s = await readOnlySession(x, actor, 'conn-dedicated-writes');
  for (const capability of ['skills.write', 'instructions.write'] as const) {
    x.permissionRepo.upsert({
      id: capability,
      effect: 'allow',
      capability,
      scope: 'workspace',
      workspaceId: x.workspace.id,
      actor,
      matcher: '*',
      createdAt: new Date().toISOString(),
    });
  }

  const skill: any = await x.service.call(s.id, 'skill_write', {
    source: 'workspace',
    name: 'demo',
    file: 'notes.md',
    content: 'bounded skill note',
  });
  assert.equal(skill.file, 'notes.md');
  assert.equal(
    readFileSync(path.join(x.workspaceRoot, '.agents', 'skills', 'demo', 'notes.md'), 'utf8'),
    'bounded skill note',
  );

  const instructions: any = await x.service.call(s.id, 'instructions_write', {
    source: 'workspace',
    content: 'bounded instructions',
  });
  assert.equal(instructions.file, 'AGENTS.md');
  assert.equal(readFileSync(path.join(x.workspaceRoot, 'AGENTS.md'), 'utf8'), 'bounded instructions');
  x.db.close();
});

test('static connector and OAuth connector request the exact missing capability', async () => {
  for (const [actor, subject] of [
    ['connector:ChatGPT', 'conn-b'],
    ['oauth:Claude', 'grant-b'],
  ] as const) {
    const x = make();
    const s = await readOnlySession(x, actor, subject);
    const blocked: any = await x.service.call(s.id, 'file_write', {
      path: '/a.txt',
      content: 'hello',
    });
    assert.equal(blocked.status, 'approval_pending');
    const ticket = x.approvals.status(blocked.requestId)!;
    const payload = ticket.payload as any;
    assert.equal(ticket.operation.capability, 'files.write');
    assert.equal(ticket.operation.family, 'capability:files.write');
    assert.equal(payload.permissionMatcher, '*');
    assert.equal(payload.requestedCapability, 'files.write');
    assert.equal(payload.profileId, undefined);
    assert.equal(x.writes.length, 0);
    x.db.close();
  }
});

test('allow once resumes exactly one write without granting commands.run', async () => {
  const x = make();
  const s = await readOnlySession(x, 'oauth:ChatGPT', 'grant-c');
  const blocked: any = await x.service.call(s.id, 'file_write', {
    path: '/a.txt',
    content: 'hello',
  });
  x.approvals.approve(blocked.requestId, 'once');
  const resumed: any = await x.service.call(s.id, 'approval_wait', {
    requestId: blocked.requestId,
  });
  assert.equal(resumed.path, '/a.txt');
  assert.equal(x.writes.length, 1);
  assert.ok(!x.sessions.activeLease(s.id)?.capabilities.includes('files.write'));
  assert.ok(!x.sessions.activeLease(s.id)?.capabilities.includes('commands.run'));
  x.db.close();
});

test('command permission is matcher-specific', async () => {
  const x = make();
  const s = await readOnlySession(x, 'connector:ChatGPT', 'conn-d');
  x.permissionRepo.upsert({
    id: 'git-status',
    effect: 'allow',
    capability: 'commands.run',
    scope: 'workspace',
    workspaceId: x.workspace.id,
    actor: 'connector:ChatGPT',
    matcher: 'git:status',
    createdAt: new Date().toISOString(),
  });
  const status: any = await x.service.call(s.id, 'aevra_status');
  assert.ok(status.effectiveCapabilities.includes('commands.run'));
  assert.deepEqual(status.commandMatchers, ['git:status']);
  await x.service.call(s.id, 'command_run', { executable: 'git', args: ['status'] });
  const blocked: any = await x.service.call(s.id, 'command_run', {
    executable: 'npm',
    args: ['test'],
  });
  assert.equal(blocked.status, 'approval_pending');
  assert.equal(x.approvals.status(blocked.requestId)!.operation.family, 'npm:test');
  x.db.close();
});
