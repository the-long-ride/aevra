import type { DatabaseSync } from 'node:sqlite';
export class ConfigExportService {
  constructor(private db: DatabaseSync) {}
  export(portable = false) {
    const workspaces = (this.db.prepare('SELECT * FROM workspaces').all() as any[]).map((w) =>
      portable
        ? { id: w.id, name: w.name, description: w.description }
        : { id: w.id, name: w.name, description: w.description, hostRoot: w.host_root },
    );
    const mounts = (this.db.prepare('SELECT * FROM external_mounts').all() as any[]).map((m) =>
      portable
        ? {
            id: m.id,
            workspaceId: m.workspace_id,
            logicalPath: m.logical_path,
            capabilities: JSON.parse(m.capabilities_json),
          }
        : {
            id: m.id,
            workspaceId: m.workspace_id,
            logicalPath: m.logical_path,
            hostRoot: m.host_root,
            capabilities: JSON.parse(m.capabilities_json),
            sensitivityPolicyId: m.sensitivity_policy_id,
          },
    );
    const rules = this.db.prepare('SELECT * FROM permission_rules').all();
    const profiles = this.db
      .prepare('SELECT id,name,capabilities_json,builtin FROM capability_profiles')
      .all();
    const envs = (this.db.prepare('SELECT * FROM environment_profiles').all() as any[]).map(
      (e) => ({
        id: e.id,
        name: e.name,
        vars: JSON.parse(e.vars_json),
        secretRefs: portable
          ? {}
          : Object.fromEntries(
              Object.keys(JSON.parse(e.secret_refs_json)).map((k) => [k, 'RECONNECT_REQUIRED']),
            ),
      }),
    );
    return { version: 1, portable, workspaces, mounts, rules, profiles, environmentProfiles: envs };
  }
  previewImport(value: any) {
    const current = new Set(
      (this.db.prepare('SELECT id FROM workspaces').all() as any[]).map((x) => x.id),
    );
    const incoming = value?.workspaces ?? [];
    return {
      add: incoming.filter((w: any) => !current.has(w.id)).length,
      change: incoming.filter((w: any) => current.has(w.id)).length,
      pathRemap: incoming.filter((w: any) => !w.hostRoot).length,
      secretReconnect: (value?.environmentProfiles ?? []).reduce(
        (n: number, e: any) => n + Object.keys(e.secretRefs ?? {}).length,
        0,
      ),
    };
  }
}
