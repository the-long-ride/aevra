import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SecretStore } from '../../../../packages/secrets/src/store.js';
export interface EnvironmentProfile {
  id: string;
  name: string;
  vars: Record<string, string>;
  secretRefs: Record<string, string>;
}
export class EnvironmentService {
  constructor(
    private db: DatabaseSync,
    private secrets: SecretStore,
  ) {}
  create(name: string, vars: Record<string, string> = {}, secretRefs: Record<string, string> = {}) {
    const id = `env_${randomUUID()}`,
      now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO environment_profiles(id,name,vars_json,secret_refs_json,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run(id, name, JSON.stringify(vars), JSON.stringify(secretRefs), now, now);
    return { id, name, vars, secretRefs };
  }
  async setSecret(ref: string, value: string, backend = 'platform') {
    await this.secrets.set(ref, value);
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT OR REPLACE INTO secret_references(id,backend,key_ref,metadata_json,created_at,updated_at) VALUES(?,?,?,?,COALESCE((SELECT created_at FROM secret_references WHERE id=?),?),?)',
      )
      .run(ref, backend, ref, '{}', ref, now, now);
    return { id: ref, backend, configured: true };
  }
  async deleteSecret(ref: string) {
    await this.secrets.delete(ref);
    this.db.prepare('DELETE FROM secret_references WHERE id=?').run(ref);
  }
  listSecretRefs() {
    return this.db
      .prepare(
        'SELECT id,backend,key_ref keyRef,metadata_json metadataJson,created_at createdAt,updated_at updatedAt FROM secret_references ORDER BY id',
      )
      .all();
  }
  list(): EnvironmentProfile[] {
    return (
      this.db
        .prepare(
          'SELECT id,name,vars_json,secret_refs_json FROM environment_profiles ORDER BY name',
        )
        .all() as any[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      vars: JSON.parse(r.vars_json),
      secretRefs: JSON.parse(r.secret_refs_json),
    }));
  }
  get(id: string): EnvironmentProfile | null {
    const r = this.db.prepare('SELECT * FROM environment_profiles WHERE id=?').get(id) as any;
    return r
      ? {
          id: r.id,
          name: r.name,
          vars: JSON.parse(r.vars_json),
          secretRefs: JSON.parse(r.secret_refs_json),
        }
      : null;
  }
  async resolve(id: string) {
    const p = this.get(id);
    if (!p) throw new Error('environment profile not found');
    const env = { ...p.vars };
    const knownSecrets = [] as string[];
    for (const [name, ref] of Object.entries(p.secretRefs)) {
      const value = await this.secrets.get(ref);
      if (value !== null) {
        env[name] = value;
        knownSecrets.push(value);
      }
    }
    return {
      env,
      knownSecrets,
      metadata: {
        ...Object.fromEntries(Object.keys(p.vars).map((k) => [k, 'configured'])),
        ...Object.fromEntries(Object.keys(p.secretRefs).map((k) => [k, 'secret configured'])),
      },
    };
  }
}
