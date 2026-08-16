import type {DatabaseSync} from 'node:sqlite';import type {Capability} from '../../../../packages/protocol/src/index.js';
export interface CapabilityProfile{id:string;name:string;capabilities:Capability[];builtin:boolean;}
export type AdmissionPolicy='ask'|'auto';
const BUILTINS:CapabilityProfile[]=[
 {id:'read-only',name:'Read Only',capabilities:['files.read','files.search','git.read'],builtin:true},
 {id:'developer',name:'Developer',capabilities:['files.read','files.search','git.read','files.write','commands.run','git.commit','network'],builtin:true},
 {id:'full-workspace',name:'Full Workspace',capabilities:['files.read','files.search','git.read','files.write','files.delete','commands.run','git.commit','git.push','network'],builtin:true},
];
export class CapabilityProfileService{constructor(private db:DatabaseSync){for(const p of BUILTINS)this.db.prepare('INSERT OR IGNORE INTO capability_profiles(id,name,capabilities_json,builtin) VALUES(?,?,?,1)').run(p.id,p.name,JSON.stringify(p.capabilities));}
 get(id:string):CapabilityProfile|null{const r=this.db.prepare('SELECT * FROM capability_profiles WHERE id=?').get(id) as any;return r?{id:r.id,name:r.name,capabilities:JSON.parse(r.capabilities_json),builtin:Boolean(r.builtin)}:null;}
 mapActor(actor:string,workspaceId:string,profileId:string,admission:AdmissionPolicy){if(!this.get(profileId))throw new Error('profile not found');this.db.prepare('INSERT OR REPLACE INTO actor_workspace_profiles(actor,workspace_id,profile_id,admission) VALUES(?,?,?,?)').run(actor,workspaceId,profileId,admission);}
 mapping(actor:string,workspaceId:string){return this.db.prepare('SELECT profile_id profileId,admission FROM actor_workspace_profiles WHERE actor=? AND workspace_id=?').get(actor,workspaceId) as {profileId:string;admission:AdmissionPolicy}|undefined;}}
