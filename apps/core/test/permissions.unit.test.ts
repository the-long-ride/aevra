import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { PermissionRepository } from '../../../packages/store/src/permissions.js';
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
