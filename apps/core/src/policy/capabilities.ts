import type { DatabaseSync } from 'node:sqlite';
import type { Capability } from '../../../../packages/protocol/src/index.js';

export interface CapabilityProfile {
  id: string;
  name: string;
  capabilities: Capability[];
  builtin: boolean;
}

export type AdmissionPolicy = 'ask' | 'auto';

export const ALL_CAPABILITIES: Capability[] = [
  'files.read',
  'files.search',
  'git.read',
  'skills.read',
  'instructions.read',
  'files.write',
  'files.delete',
  'commands.run',
  'git.commit',
  'git.push',
  'network',
  'skills.write',
  'instructions.write',
];

export const BUILTIN_CAPABILITY_PROFILES: CapabilityProfile[] = [
  {
    id: 'read-only',
    name: 'Read Only',
    capabilities: ['files.read', 'files.search', 'git.read', 'skills.read', 'instructions.read'],
    builtin: true,
  },
  {
    id: 'coding-session',
    name: 'Coding Session',
    capabilities: [
      'files.read',
      'files.search',
      'git.read',
      'skills.read',
      'instructions.read',
      'files.write',
      'commands.run',
    ],
    builtin: true,
  },
  {
    id: 'developer',
    name: 'Developer',
    capabilities: [
      'files.read',
      'files.search',
      'git.read',
      'skills.read',
      'instructions.read',
      'files.write',
      'commands.run',
      'git.commit',
      'network',
    ],
    builtin: true,
  },
  {
    id: 'full-workspace',
    name: 'Full Workspace',
    capabilities: [...ALL_CAPABILITIES],
    builtin: true,
  },
];

export class CapabilityProfileService {
  constructor(private db: DatabaseSync) {
    const upsertBuiltin = this.db.prepare(
      `INSERT INTO capability_profiles(id,name,capabilities_json,builtin) VALUES(?,?,?,1)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,
         capabilities_json=excluded.capabilities_json,
         builtin=1
       WHERE capability_profiles.builtin=1`,
    );
    for (const p of BUILTIN_CAPABILITY_PROFILES)
      upsertBuiltin.run(p.id, p.name, JSON.stringify(p.capabilities));
  }
  get(id: string): CapabilityProfile | null {
    const r = this.db.prepare('SELECT * FROM capability_profiles WHERE id=?').get(id) as any;
    return r
      ? {
          id: r.id,
          name: r.name,
          capabilities: JSON.parse(r.capabilities_json),
          builtin: Boolean(r.builtin),
        }
      : null;
  }
  mapActor(actor: string, workspaceId: string, profileId: string, admission: AdmissionPolicy) {
    if (!this.get(profileId)) throw new Error('profile not found');
    this.db
      .prepare(
        'INSERT OR REPLACE INTO actor_workspace_profiles(actor,workspace_id,profile_id,admission) VALUES(?,?,?,?)',
      )
      .run(actor, workspaceId, profileId, admission);
  }
  mapping(actor: string, workspaceId: string) {
    return this.db
      .prepare(
        'SELECT profile_id profileId,admission FROM actor_workspace_profiles WHERE actor=? AND workspace_id=?',
      )
      .get(actor, workspaceId) as { profileId: string; admission: AdmissionPolicy } | undefined;
  }
  listMappings(workspaceId: string) {
    return this.db
      .prepare(
        'SELECT awp.actor actor,awp.workspace_id workspaceId,awp.profile_id profileId,awp.admission admission,cp.name profileName FROM actor_workspace_profiles awp LEFT JOIN capability_profiles cp ON cp.id=awp.profile_id WHERE awp.workspace_id=? ORDER BY awp.actor',
      )
      .all(workspaceId) as Array<{
      actor: string;
      workspaceId: string;
      profileId: string;
      admission: AdmissionPolicy;
      profileName?: string;
    }>;
  }
}
