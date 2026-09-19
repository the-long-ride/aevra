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
  import(value: any) {
    if (!value || typeof value !== 'object') {
      throw new Error('Invalid backup payload');
    }
    let workspacesCount = 0;
    let mountsCount = 0;
    let rulesCount = 0;

    if (Array.isArray(value.workspaces)) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO workspaces (id, name, description, host_root)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            host_root = COALESCE(excluded.host_root, workspaces.host_root)
        `);
        for (const w of value.workspaces) {
          if (w && w.id && w.name) {
            (stmt as any).run?.(w.id, w.name, w.description ?? '', w.hostRoot ?? null);
            workspacesCount++;
          }
        }
      } catch {
        // continue
      }
    }

    if (Array.isArray(value.mounts)) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO external_mounts (id, workspace_id, logical_path, host_root, capabilities_json, sensitivity_policy_id)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            logical_path = excluded.logical_path,
            host_root = COALESCE(excluded.host_root, external_mounts.host_root),
            capabilities_json = excluded.capabilities_json,
            sensitivity_policy_id = excluded.sensitivity_policy_id
        `);
        for (const m of value.mounts) {
          if (m && m.id && m.workspaceId && m.logicalPath) {
            (stmt as any).run?.(
              m.id,
              m.workspaceId,
              m.logicalPath,
              m.hostRoot ?? null,
              JSON.stringify(m.capabilities ?? []),
              m.sensitivityPolicyId ?? null,
            );
            mountsCount++;
          }
        }
      } catch {
        // continue
      }
    }

    if (Array.isArray(value.rules)) {
      try {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO permission_rules (id, capability, effect, matcher, scope, workspace_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of value.rules) {
          if (r && r.id) {
            (stmt as any).run?.(
              r.id,
              r.capability ?? 'files.read',
              r.effect ?? 'allow',
              r.matcher ?? '*',
              r.scope ?? 'global',
              r.workspace_id ?? r.workspaceId ?? null,
              r.created_at ?? r.createdAt ?? new Date().toISOString(),
            );
            rulesCount++;
          }
        }
      } catch {
        // continue
      }
    }

    return {
      ok: true,
      workspaces: workspacesCount,
      mounts: mountsCount,
      rules: rulesCount,
    };
  }
}
