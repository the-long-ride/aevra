import { randomUUID } from 'node:crypto'; import type { DatabaseSync } from 'node:sqlite'; import type { Capability } from '../../protocol/src/index.js';
export interface WorkspaceRecord{id:string;name:string;description:string;hostRoot:string;}
export interface WorkspaceRemoteView{id:string;name:string;description:string;}
export interface MountRecord{id:string;workspaceId:string;logicalPath:string;hostRoot:string;capabilities:Capability[];sensitivityPolicyId?:string;}
export class WorkspaceRepository{constructor(private db:DatabaseSync){}
 create(input:{name:string;description?:string;hostRoot:string}):WorkspaceRecord{const id=randomUUID(),now=new Date().toISOString();this.db.prepare('INSERT INTO workspaces(id,name,description,host_root,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,input.name,input.description??'',input.hostRoot,now,now);return{id,name:input.name,description:input.description??'',hostRoot:input.hostRoot};}
 update(id:string,input:Partial<Omit<WorkspaceRecord,'id'>>){const cur=this.get(id);if(!cur)throw new Error('workspace not found');const next={...cur,...input};this.db.prepare('UPDATE workspaces SET name=?,description=?,host_root=?,updated_at=? WHERE id=?').run(next.name,next.description,next.hostRoot,new Date().toISOString(),id);return next;}
 get(id:string):WorkspaceRecord|null{const r=this.db.prepare('SELECT id,name,description,host_root hostRoot FROM workspaces WHERE id=?').get(id) as WorkspaceRecord|undefined;return r??null;}
 getByName(name:string){const r=this.db.prepare('SELECT id,name,description,host_root hostRoot FROM workspaces WHERE lower(name)=lower(?)').get(name) as WorkspaceRecord|undefined;return r??null;}
 list():WorkspaceRecord[]{return this.db.prepare('SELECT id,name,description,host_root hostRoot FROM workspaces ORDER BY name').all() as unknown as WorkspaceRecord[];}
 listRemote():WorkspaceRemoteView[]{return this.list().map(({id,name,description})=>({id,name,description}));}
 delete(id:string){this.db.prepare('DELETE FROM workspaces WHERE id=?').run(id);}
 addMount(workspaceId:string,input:{logicalPath:string;hostRoot:string;capabilities:Capability[];sensitivityPolicyId?:string}){const id=randomUUID();this.db.prepare('INSERT INTO external_mounts(id,workspace_id,logical_path,host_root,capabilities_json,sensitivity_policy_id) VALUES(?,?,?,?,?,?)').run(id,workspaceId,input.logicalPath,input.hostRoot,JSON.stringify(input.capabilities),input.sensitivityPolicyId??null);return{id,workspaceId,...input};}
 listMounts(workspaceId:string):MountRecord[]{return (this.db.prepare('SELECT id,workspace_id workspaceId,logical_path logicalPath,host_root hostRoot,capabilities_json capabilitiesJson,sensitivity_policy_id sensitivityPolicyId FROM external_mounts WHERE workspace_id=?').all(workspaceId) as any[]).map(r=>({...r,capabilities:JSON.parse(r.capabilitiesJson),capabilitiesJson:undefined}));}
 deleteMount(id:string){this.db.prepare('DELETE FROM external_mounts WHERE id=?').run(id);}}
