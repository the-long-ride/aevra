import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { PermissionRepository } from '../../../packages/store/src/permissions.js';
import {
  convertLegacyMatcher,
  migratePermissionRules,
} from '../src/policy/command-rule-migration.js';

test('A21: Narrow legacy matchers convert to active typed rules', () => {
  const gitStatus = convertLegacyMatcher('git:status', 'allow');
  assert.equal(gitStatus.status, 'active');
  assert.equal(gitStatus.predicate?.application, 'git');
  assert.deepEqual(gitStatus.predicate?.operation, ['status']);

  const npmDev = convertLegacyMatcher('npm:run:dev', 'allow');
  assert.equal(npmDev.status, 'active');
  assert.equal(npmDev.predicate?.application, 'npm');
  assert.equal(npmDev.predicate?.scriptName, 'dev');
});

test('A21: Broad shell and app wildcards require operator review and do not auto-upgrade', () => {
  const shellWildcard = convertLegacyMatcher('shell:*', 'allow');
  assert.equal(shellWildcard.status, 'needs-review');

  const star = convertLegacyMatcher('*', 'allow');
  assert.equal(star.status, 'needs-review');

  const gitWildcard = convertLegacyMatcher('git:*', 'allow');
  assert.equal(gitWildcard.status, 'needs-review');

  const npmWildcard = convertLegacyMatcher('npm:*', 'allow');
  assert.equal(npmWildcard.status, 'needs-review');
});

test('Database migration updates existing legacy permission rows safely', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new PermissionRepository(db.raw());

  // Insert a narrow rule and a broad wildcard rule
  repo.upsert({
    id: 'perm_narrow',
    subject: 'test-subject',
    capability: 'commands.run',
    matcher: 'git:status',
    effect: 'allow',
    scope: 'workspace',
  });

  repo.upsert({
    id: 'perm_broad',
    subject: 'test-subject',
    capability: 'commands.run',
    matcher: 'shell:*',
    effect: 'allow',
    scope: 'workspace',
  });

  const { migratedCount, needsReviewCount } = migratePermissionRules(repo);
  assert.equal(migratedCount, 1);
  assert.equal(needsReviewCount, 1);

  const narrowRow = repo.get('perm_narrow');
  assert.equal(narrowRow?.version, 2);
  assert.equal(narrowRow?.status, 'active');
  assert.ok(narrowRow?.predicate_json);

  const broadRow = repo.get('perm_broad');
  assert.equal(broadRow?.status, 'needs-review');

  db.close();
});
