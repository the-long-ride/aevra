import type { DatabaseSync } from 'node:sqlite';
import { oauthActor, redirectOrigin } from '../oauth-actor.js';

export function migrateOAuthActors(db: DatabaseSync) {
  const clients = db
    .prepare('SELECT client_id id,client_name name,redirect_uris_json redirects FROM oauth_clients')
    .all() as Array<{ id: string; name: string; redirects: string }>;
  const byName = new Map<string, Set<string>>();
  const byClient = new Map<string, string>();
  for (const client of clients) {
    const origins = new Set<string>();
    for (const uri of JSON.parse(client.redirects)) {
      try {
        origins.add(redirectOrigin(uri));
      } catch {
        /* malformed historical metadata has no authority */
      }
    }
    const actors = byName.get(client.name) ?? new Set<string>();
    for (const origin of origins) actors.add(oauthActor(client.name, origin));
    byName.set(client.name, actors);
    if (origins.size === 1) byClient.set(client.id, oauthActor(client.name, [...origins][0]!));
  }
  for (const client of clients) {
    const actor = byClient.get(client.id);
    if (!actor) {
      db.prepare(
        "UPDATE oauth_connections SET status='REVOKED',revoke_reason='ACTOR_ORIGIN_REQUIRED' WHERE client_id=? AND actor=?",
      ).run(client.id, `oauth:${client.name}`);
      continue;
    }
    for (const table of ['oauth_connections', 'oauth_access_tokens', 'oauth_refresh_tokens'])
      db.prepare(`UPDATE ${table} SET actor=? WHERE client_id=? AND actor=?`).run(
        actor,
        client.id,
        `oauth:${client.name}`,
      );
    db.prepare(
      'UPDATE sessions SET actor=? WHERE subject IN (SELECT subject FROM oauth_connections WHERE client_id=?) AND actor=?',
    ).run(actor, client.id, `oauth:${client.name}`);
    db.prepare(
      'UPDATE pending_approvals SET actor=? WHERE connection_subject IN (SELECT subject FROM oauth_connections WHERE client_id=?) AND actor=?',
    ).run(actor, client.id, `oauth:${client.name}`);
  }
  const aliases = new Map<string, string>();
  const legacyActors = new Set(clients.map((client) => `oauth:${client.name}`));
  const collisions = new Set(
    [...byName.values()]
      .flatMap((actors) => [...actors])
      .filter((actor) => legacyActors.has(actor)),
  );
  for (const [name, actors] of byName) {
    const before = `oauth:${name}`;
    if (actors.size !== 1 || collisions.has(before)) {
      console.warn(
        `[aevra] ${before}: ambiguous actor namespace or redirect origins; remembered rules require review`,
      );
      continue;
    }
    aliases.set(before, [...actors][0]!);
  }
  // Use original row identities, never a previously rewritten actor as a source.
  // A legacy name that is also a new actor is ambiguous and loses shared authority.
  for (const table of ['permission_rules', 'actor_workspace_profiles']) {
    const rows = db.prepare(`SELECT rowid id,actor FROM ${table}`).all() as Array<{
      id: number;
      actor: string;
    }>;
    for (const row of rows)
      if (collisions.has(row.actor)) db.prepare(`DELETE FROM ${table} WHERE rowid=?`).run(row.id);
    for (const row of rows) {
      const after = aliases.get(row.actor);
      if (!after) continue;
      db.prepare(`UPDATE OR IGNORE ${table} SET actor=? WHERE rowid=?`).run(after, row.id);
      db.prepare(`DELETE FROM ${table} WHERE rowid=? AND actor=?`).run(row.id, row.actor);
    }
  }
  const setting = db
    .prepare("SELECT value_json value FROM settings WHERE key='mcp.connectorProfiles'")
    .get() as { value: string } | undefined;
  if (setting) {
    const original = JSON.parse(setting.value);
    const profiles = { ...original };
    for (const before of [...aliases.keys(), ...collisions]) delete profiles[before];
    for (const [before, after] of aliases) {
      if (Object.hasOwn(original, before) && !Object.hasOwn(profiles, after))
        profiles[after] = original[before];
    }
    db.prepare("UPDATE settings SET value_json=? WHERE key='mcp.connectorProfiles'").run(
      JSON.stringify(profiles),
    );
  }
  const codes = db
    .prepare(
      'SELECT code_hash hash,client_id clientId,redirect_uri uri FROM oauth_authorization_codes',
    )
    .all() as Array<{ hash: string; clientId: string; uri: string }>;
  for (const code of codes) {
    const client = clients.find((item) => item.id === code.clientId);
    if (client)
      db.prepare('UPDATE oauth_authorization_codes SET actor=? WHERE code_hash=?').run(
        oauthActor(client.name, code.uri),
        code.hash,
      );
  }
}
