import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { applyMigrations } from '../src/migrations.js';
import { OAuthRepository } from '../src/oauth.js';
import { oauthActor, redirectOrigin } from '../src/oauth-actor.js';

const T0 = Date.parse('2026-10-01T00:00:00.000Z');

function openRepo(clock = { now: T0 }) {
  const db = AevraDatabase.open(':memory:');
  return {
    db,
    raw: db.raw(),
    clock,
    repo: new OAuthRepository(db.raw(), () => new Date(clock.now)),
  };
}

function pending(repo: OAuthRepository, clientId: string, redirectUri: string) {
  return repo.createAuthorizationRequest(
    {
      clientId,
      redirectUri,
      scope: 'mcp',
      resource: 'https://mcp.example.com/mcp',
      codeChallenge: 'c'.repeat(43),
      codeChallengeMethod: 'S256',
    },
    60_000,
  );
}

function connect(repo: OAuthRepository, clientId: string, actor: string, subject: string) {
  repo.ensureConnection({
    clientId,
    actor,
    subject,
    scope: 'mcp',
    resource: 'https://mcp.example.com/mcp',
  });
}

test('oauth actor binds the client name to the redirect URI origin', () => {
  assert.equal(redirectOrigin('https://ChatGPT.com:443/cb?x=1'), 'https://chatgpt.com');
  assert.equal(
    oauthActor('ChatGPT', 'https://chatgpt.com/oauth/cb'),
    'oauth:ChatGPT@https://chatgpt.com',
  );
  assert.equal(oauthActor('Local', 'http://127.0.0.1:9/cb'), 'oauth:Local@http://127.0.0.1:9');
});

test('issued codes carry the origin of the redirect URI that receives the code', () => {
  const { db, repo } = openRepo();
  const client = repo.registerClient({
    clientName: 'ChatGPT',
    redirectUris: ['https://chatgpt.com/cb', 'https://lookalike.example/cb'],
  });
  const first = pending(repo, client.clientId, 'https://chatgpt.com/cb');
  repo.approveAuthorizationRequest(first.id);
  const a = repo.consumeAuthorizationCode(repo.issueAuthorizationCode(first.id, 60_000).code);
  assert.equal(a?.actor, 'oauth:ChatGPT@https://chatgpt.com');
  const second = pending(repo, client.clientId, 'https://lookalike.example/cb');
  repo.approveAuthorizationRequest(second.id);
  const b = repo.consumeAuthorizationCode(repo.issueAuthorizationCode(second.id, 60_000).code);
  assert.equal(b?.actor, 'oauth:ChatGPT@https://lookalike.example');
  db.close();
});

test('never-connected clients are counted, pruned after 24h and deletable', () => {
  const { db, repo, clock } = openRepo();
  const idle = repo.registerClient({ clientName: 'idle', redirectUris: ['https://a.example/cb'] });
  const used = repo.registerClient({ clientName: 'used', redirectUris: ['https://b.example/cb'] });
  connect(repo, used.clientId, 'oauth:used@https://b.example', 'sub_used');
  assert.equal(repo.countUnconnectedClients(), 1);
  clock.now = T0 + 23 * 3_600_000;
  assert.equal(repo.pruneUnconnectedClients(24 * 3_600_000), 0);
  clock.now = T0 + 25 * 3_600_000;
  assert.equal(repo.pruneUnconnectedClients(24 * 3_600_000), 1);
  assert.equal(repo.getClient(idle.clientId), null);
  assert.ok(repo.getClient(used.clientId));
  assert.equal(repo.deleteClient('missing'), 'not_found');
  assert.equal(repo.deleteClient(used.clientId), 'active_connections');
  repo.revokeConnection('sub_used', 'TEST');
  assert.equal(repo.deleteClient(used.clientId), 'deleted');
  assert.equal(repo.getClient(used.clientId), null);
  db.close();
});

test('pending authorization requests are trimmed per client, oldest first', () => {
  const { db, repo, clock } = openRepo();
  const client = repo.registerClient({ clientName: 'c', redirectUris: ['https://a.example/cb'] });
  const other = repo.registerClient({ clientName: 'd', redirectUris: ['https://a.example/cb'] });
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    clock.now = T0 + i * 1000;
    ids.push(pending(repo, client.clientId, 'https://a.example/cb').id);
  }
  pending(repo, other.clientId, 'https://a.example/cb');
  assert.equal(repo.trimPendingAuthorizationRequests(client.clientId, 2), 2);
  const left = repo.listPendingAuthorizationRequests().map((row) => row.id);
  assert.deepEqual(
    left.filter((id) => ids.includes(id)),
    ids.slice(2),
  );
  assert.equal(left.length, 3);
  assert.equal(repo.trimPendingAuthorizationRequests(client.clientId, 2), 0);
  db.close();
});

function rerunActorMigration(raw: any) {
  raw.prepare("DELETE FROM schema_migrations WHERE name='026_oauth_actor_origin'").run();
  applyMigrations(raw);
}

test('migration 026 rewrites name-only actors to name@origin where unambiguous', () => {
  const { db, raw, repo } = openRepo();
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message: string) => warnings.push(String(message));
  try {
    const chat = repo.registerClient({
      clientName: 'ChatGPT',
      redirectUris: ['https://chatgpt.com/cb'],
    });
    repo.registerClient({ clientName: 'ChatGPT', redirectUris: ['https://chatgpt.com/other'] });
    repo.registerClient({ clientName: 'Twin', redirectUris: ['https://one.example/cb'] });
    const twinB = repo.registerClient({
      clientName: 'Twin',
      redirectUris: ['https://two.example/cb'],
    });
    connect(repo, chat.clientId, 'oauth:ChatGPT', 'sub_chat');
    connect(repo, twinB.clientId, 'oauth:Twin', 'sub_twin');
    const now = '2026-10-01T00:00:00.000Z';
    raw
      .prepare(
        'INSERT INTO sessions(id,actor,subject,created_at,last_activity_at) VALUES(?,?,?,?,?)',
      )
      .run('s1', 'oauth:ChatGPT', 'sub_chat', now, now);
    raw
      .prepare(
        'INSERT INTO sessions(id,actor,subject,created_at,last_activity_at) VALUES(?,?,?,?,?)',
      )
      .run('s2', 'oauth:Twin', 'sub_twin', now, now);
    const rule = raw.prepare(
      "INSERT INTO permission_rules(id,effect,capability,scope,actor,matcher,created_at) VALUES(?,'allow','files.read','global',?,'*',?)",
    );
    rule.run('r1', 'oauth:ChatGPT', now);
    rule.run('r2', 'oauth:Twin', now);
    rule.run('r3', 'connector:ChatGPT', now);
    raw
      .prepare(
        "INSERT INTO workspaces(id,name,host_root,created_at,updated_at) VALUES('w1','w','/tmp/w',?,?)",
      )
      .run(now, now);
    raw
      .prepare(
        "INSERT INTO actor_workspace_profiles(actor,workspace_id,profile_id,admission) VALUES('oauth:ChatGPT','w1','developer','auto')",
      )
      .run();
    raw
      .prepare("INSERT INTO settings(key,value_json,revision) VALUES('mcp.connectorProfiles',?,1)")
      .run(
        JSON.stringify({
          'oauth:ChatGPT': { resultFormat: 'text' },
          'oauth:Twin': { resultFormat: 'text' },
        }),
      );

    rerunActorMigration(raw);

    const actorOf = (sql: string, id: string) => (raw.prepare(sql).get(id) as any).actor;
    assert.equal(
      actorOf('SELECT actor FROM permission_rules WHERE id=?', 'r1'),
      'oauth:ChatGPT@https://chatgpt.com',
    );
    assert.equal(actorOf('SELECT actor FROM permission_rules WHERE id=?', 'r2'), 'oauth:Twin');
    assert.equal(
      actorOf('SELECT actor FROM permission_rules WHERE id=?', 'r3'),
      'connector:ChatGPT',
    );
    assert.equal(
      actorOf('SELECT actor FROM sessions WHERE id=?', 's1'),
      'oauth:ChatGPT@https://chatgpt.com',
    );
    assert.equal(
      actorOf('SELECT actor FROM sessions WHERE id=?', 's2'),
      'oauth:Twin@https://two.example',
    );
    assert.equal(repo.getConnection('sub_chat')?.actor, 'oauth:ChatGPT@https://chatgpt.com');
    assert.equal(repo.getConnection('sub_twin')?.actor, 'oauth:Twin@https://two.example');
    assert.equal(
      actorOf('SELECT actor FROM actor_workspace_profiles WHERE workspace_id=?', 'w1'),
      'oauth:ChatGPT@https://chatgpt.com',
    );
    const profiles = JSON.parse(
      (
        raw
          .prepare("SELECT value_json FROM settings WHERE key='mcp.connectorProfiles'")
          .get() as any
      ).value_json,
    );
    assert.deepEqual(Object.keys(profiles).sort(), [
      'oauth:ChatGPT@https://chatgpt.com',
      'oauth:Twin',
    ]);
    assert.ok(warnings.some((line) => line.includes('oauth:Twin')));
  } finally {
    console.warn = originalWarn;
    db.close();
  }
});
