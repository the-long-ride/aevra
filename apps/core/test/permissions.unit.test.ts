import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { PermissionRepository } from '../../../packages/store/src/permissions.js';
import { CapabilityProfileService } from '../src/policy/capabilities.js';
import { PermissionEngine } from '../src/policy/permissions.js';
test('workspace allow beats global deny; equal specificity deny wins', () => {
  const db = AevraDatabase.open(':memory:');
  const r = new PermissionRepository(db.raw()),
    e = new PermissionEngine(r);
  r.upsert({
    id: 'g',
    effect: 'deny',
    capability: 'commands.run',
    scope: 'global',
    matcher: 'dotnet:*',
  });
  r.upsert({
    id: 'w',
    effect: 'allow',
    capability: 'commands.run',
    scope: 'workspace',
    workspaceId: 'w',
    matcher: 'dotnet:test',
  });
  assert.equal(
    e.decide({ capability: 'commands.run', matcher: 'dotnet:test', workspaceId: 'w', risk: 'LOW' })
      .outcome,
    'allow',
  );
  r.upsert({
    id: 'w2',
    effect: 'deny',
    capability: 'commands.run',
    scope: 'workspace',
    workspaceId: 'w',
    matcher: 'dotnet:test',
  });
  assert.equal(
    e.decide({ capability: 'commands.run', matcher: 'dotnet:test', workspaceId: 'w', risk: 'LOW' })
      .outcome,
    'deny',
  );
  db.close();
});
test('critical persistent allow is ignored for step-up', () => {
  const db = AevraDatabase.open(':memory:');
  const r = new PermissionRepository(db.raw()),
    e = new PermissionEngine(r);
  r.upsert({
    id: 'x',
    effect: 'allow',
    capability: 'commands.run',
    scope: 'global',
    matcher: 'git:push',
  });
  assert.equal(
    e.decide({ capability: 'commands.run', matcher: 'git:push', risk: 'CRITICAL' }).outcome,
    'approval',
  );
  db.close();
});
test('skill and instruction capabilities are independent from file capabilities', () => {
  const db = AevraDatabase.open(':memory:');
  const r = new PermissionRepository(db.raw()),
    e = new PermissionEngine(r);
  r.upsert({
    id: 'files',
    effect: 'allow',
    capability: 'files.write',
    scope: 'workspace',
    workspaceId: 'w',
    matcher: '*',
  });
  r.upsert({
    id: 'skills',
    effect: 'allow',
    capability: 'skills.read',
    scope: 'workspace',
    workspaceId: 'w',
    matcher: '*',
  });
  r.upsert({
    id: 'instructions',
    effect: 'allow',
    capability: 'instructions.write',
    scope: 'workspace',
    workspaceId: 'w',
    matcher: '*',
  });

  const summary = e.summary({
    workspaceId: 'w',
    baselineCapabilities: [],
  });
  assert.equal(summary.effectiveCapabilities.includes('files.write'), true);
  assert.equal(summary.effectiveCapabilities.includes('skills.read'), true);
  assert.equal(summary.effectiveCapabilities.includes('instructions.write'), true);
  assert.equal(summary.effectiveCapabilities.includes('skills.write'), false);
  assert.equal(summary.effectiveCapabilities.includes('instructions.read'), false);
  db.close();
});
test('built-in profiles refresh capability definitions on upgrade', () => {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();
  raw
    .prepare('INSERT INTO capability_profiles(id,name,capabilities_json,builtin) VALUES(?,?,?,1)')
    .run('read-only', 'Read Only', JSON.stringify(['files.read']));
  const profiles = new CapabilityProfileService(raw);
  const readOnly = profiles.get('read-only')!;
  assert.equal(readOnly.capabilities.includes('skills.read'), true);
  assert.equal(readOnly.capabilities.includes('instructions.read'), true);
  db.close();
});

test('equal specificity rules sort deterministically by id', () => {
  const db = AevraDatabase.open(':memory:');
  const r = new PermissionRepository(db.raw()),
    e = new PermissionEngine(r);

  r.upsert({
    id: 'rule_b',
    effect: 'allow',
    capability: 'commands.run',
    scope: 'workspace',
    workspaceId: 'w',
    matcher: 'git:status',
  });
  r.upsert({
    id: 'rule_a',
    effect: 'allow',
    capability: 'commands.run',
    scope: 'workspace',
    workspaceId: 'w',
    matcher: 'git:status',
  });

  const decision = e.decide({
    capability: 'commands.run',
    matcher: 'git:status',
    workspaceId: 'w',
    risk: 'LOW',
  });
  assert.equal(decision.ruleId, 'rule_a');

  // CapabilityProfileService tests
  const now = new Date().toISOString();
  db.raw()
    .prepare(
      'INSERT OR REPLACE INTO workspaces(id,name,host_root,created_at,updated_at) VALUES(?,?,?,?,?)',
    )
    .run('w', 'Workspace', '/tmp/w', now, now);

  const profiles = new CapabilityProfileService(db.raw());
  assert.equal(profiles.get('nonexistent_profile'), null);
  assert.throws(
    () => profiles.mapActor('user1', 'w', 'nonexistent_profile', 'auto'),
    /profile not found/,
  );

  profiles.mapActor('user1', 'w', 'read-only', 'auto');
  const mappings = profiles.listMappings('w');
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0]?.actor, 'user1');
  assert.equal(mappings[0]?.profileName, 'Read Only');

  db.close();
});
