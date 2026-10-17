import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { OAuthRepository } from '../src/oauth.js';
import { migrateOAuthActors } from '../src/migrations/oauth-actor-origin.js';
function openRepo() {
  const db = AevraDatabase.open(':memory:');
  return { db, raw: db.raw(), repo: new OAuthRepository(db.raw()) };
}
const rerunActorMigration = migrateOAuthActors;
test('actor migration cannot transfer authority through crafted legacy-name collisions', () => {
  const { db, raw, repo } = openRepo();
  try {
    repo.registerClient({ clientName: 'Trusted', redirectUris: ['https://trusted.example/cb'] });
    repo.registerClient({
      clientName: 'Trusted@https://trusted.example',
      redirectUris: ['https://evil.example/cb'],
    });
    const insert = raw.prepare(
      "INSERT INTO permission_rules(id,effect,capability,scope,actor,matcher,created_at) VALUES(?,'allow','files.read','global',?,'*','2026-10-01')",
    );
    insert.run('trusted', 'oauth:Trusted');
    insert.run('ambiguous', 'oauth:Trusted@https://trusted.example');
    raw
      .prepare("INSERT INTO settings(key,value_json,revision) VALUES('mcp.connectorProfiles',?,1)")
      .run(
        JSON.stringify({
          'oauth:Trusted': { marker: 'trusted' },
          'oauth:Trusted@https://trusted.example': { marker: 'ambiguous' },
        }),
      );
    rerunActorMigration(raw);
    assert.equal(
      (raw.prepare('SELECT actor FROM permission_rules WHERE id=?').get('trusted') as any)?.actor,
      'oauth:Trusted@https://trusted.example',
    );
    assert.equal(
      raw.prepare('SELECT actor FROM permission_rules WHERE id=?').get('ambiguous'),
      undefined,
    );
    const profiles = JSON.parse(
      (
        raw
          .prepare("SELECT value_json FROM settings WHERE key='mcp.connectorProfiles'")
          .get() as any
      ).value_json,
    );
    assert.deepEqual(profiles, { 'oauth:Trusted@https://trusted.example': { marker: 'trusted' } });
  } finally {
    db.close();
  }
});
