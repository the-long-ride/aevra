import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SessionRepository } from '../../../packages/store/src/sessions.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { SessionManager } from '../src/sessions/session-manager.js';
import { SkillsService } from '../src/skills/skills-service.js';
import { McpToolService } from '../../../packages/mcp-tools/src/service.js';
import { handleJsonRpc } from '../../../packages/mcp-tools/src/register.js';
function setup(home: string) {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();
  const sessions = new SessionManager(
    new SessionRepository(raw),
    new CapabilityProfileService(raw),
  );
  const session = sessions.create({
    subject: 'sub',
    actor: 'actor@example.test',
    issuer: 'i',
    audience: 'a',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  } as any);
  const workspaces: any = { listRemote: () => [], getLocal: () => null, capabilityRoots: () => [] };
  const tools = new McpToolService(
    sessions,
    workspaces,
    {
      execute: async () => ({
        ok: false,
        error: { code: 'EXECUTOR_UNAVAILABLE', message: 'none' },
      }),
    } as any,
    { put() {} } as any,
    undefined,
    { skills: new SkillsService(home) },
  );
  return { db, session, tools };
}
async function call(tools: McpToolService, session: any, method: string, args: any) {
  const r = await handleJsonRpc(tools as any, session.id, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: method, arguments: args },
  });
  return JSON.parse(r.result.content[0].text);
}
test('tools/list includes the three skills tools', async () => {
  const { db, tools } = setup(tmpdir());
  const r = await handleJsonRpc(tools as any, 'x', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const names = (r.result.tools as any[]).map((t) => t.name);
  for (const n of ['skills_list', 'skill_read', 'instructions_read'])
    assert.ok(names.includes(n), n);
  db.close();
});
test('skills round-trip works without a workspace lease', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'aevra-sk-'));
  mkdirSync(path.join(base, '.agents', 'skills', 'demo'), { recursive: true });
  writeFileSync(
    path.join(base, '.agents', 'skills', 'demo', 'SKILL.md'),
    '---\nname: Demo\ndescription: demo skill\n---\nbody',
  );
  const { db, session, tools } = setup(base);
  const listed = await call(tools, session, 'skills_list', {});
  assert.equal(listed.skills.length, 1);
  assert.equal(listed.skills[0].name, 'Demo');
  const read = await call(tools, session, 'skill_read', { source: 'user', name: 'Demo' });
  assert.match(read.content, /body/);
  const instr = await call(tools, session, 'instructions_read', {});
  assert.deepEqual(instr.instructions, []);
  assert.ok(instr.note);
  db.close();
});
test('unknown skill surfaces SKILL_NOT_FOUND tool error', async () => {
  const { db, session, tools } = setup(tmpdir());
  const r = await handleJsonRpc(tools as any, session.id, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'skill_read', arguments: { source: 'user', name: 'ghost' } },
  });
  const payload = JSON.parse(r.result.content[0].text);
  assert.equal(payload.error.code, 'SKILL_NOT_FOUND');
  db.close();
});

test('skills_list supports query and pagination', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'aevra-sk-page-'));
  for (const n of ['alpha', 'beta', 'gamma']) {
    mkdirSync(path.join(base, '.agents', 'skills', n), { recursive: true });
    writeFileSync(
      path.join(base, '.agents', 'skills', n, 'SKILL.md'),
      `---\nname: ${n}\ndescription: skill ${n}\n---\nbody`,
    );
  }
  const { db, session, tools } = setup(base);
  const q = await call(tools, session, 'skills_list', { query: 'bet' });
  assert.equal(q.total, 1);
  assert.equal(q.skills[0].name, 'beta');
  const page1 = await call(tools, session, 'skills_list', { limit: 2, offset: 0 });
  const page2 = await call(tools, session, 'skills_list', { limit: 2, offset: 2 });
  assert.equal(page1.skills.length, 2);
  assert.equal(page2.skills.length, 1);
  assert.equal(page1.total, 3);
  const all = await call(tools, session, 'skills_list', {});
  assert.equal(all.skills.length, 3);
  db.close();
});
test('resources/prompts surface exposes skills and instructions', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'aevra-res-'));
  mkdirSync(path.join(base, '.agents', 'skills', 'demo'), { recursive: true });
  writeFileSync(
    path.join(base, '.agents', 'skills', 'demo', 'SKILL.md'),
    '---\nname: Demo\ndescription: demo skill\n---\nresource body',
  );
  writeFileSync(path.join(base, '.agents', 'AGENTS.md'), 'global rules');
  const { db, session, tools } = setup(base);
  const rl = await handleJsonRpc(tools as any, session.id, {
    jsonrpc: '2.0',
    id: 1,
    method: 'resources/list',
  });
  assert.equal(rl.result.resources[0].uri, 'aevra://skill/user/Demo');
  const rr = await handleJsonRpc(tools as any, session.id, {
    jsonrpc: '2.0',
    id: 2,
    method: 'resources/read',
    params: { uri: 'aevra://skill/user/Demo' },
  });
  assert.match(rr.result.contents[0].text, /resource body/);
  const pl = await handleJsonRpc(tools as any, session.id, {
    jsonrpc: '2.0',
    id: 3,
    method: 'prompts/list',
  });
  assert.equal(pl.result.prompts[0].name, 'aevra-instructions');
  const pg = await handleJsonRpc(tools as any, session.id, {
    jsonrpc: '2.0',
    id: 4,
    method: 'prompts/get',
    params: { name: 'aevra-instructions' },
  });
  assert.match(pg.result.messages[0].content.text, /global rules/);
  db.close();
});
