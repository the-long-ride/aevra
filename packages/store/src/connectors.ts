import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
export interface ConnectorRecord{id:string;name:string;createdAt:string;lastUsedAt:string|null;workspaceId:string|null;profileCap:string|null;expiresAt:string|null;}
export interface ConnectorTokenRecord{id:string;name:string;workspaceId:string|null;profileCap:string|null;expiresAt:string|null;}
export interface ConnectorCreateInput{name:string;workspaceId?:string|null;profileCap?:string|null;expiresAt?:string|null;}
export class ConnectorRepository{
  constructor(private db:DatabaseSync){}
  create(input:string|ConnectorCreateInput):{connector:ConnectorRecord;token:string}{
    const x=typeof input==='string'?{name:input}:input;
    const token=randomBytes(16).toString('base64url');
    const hash=ConnectorRepository.hash(token);
    const connector:ConnectorRecord={id:`con_${randomUUID()}`,name:x.name,createdAt:new Date().toISOString(),lastUsedAt:null,workspaceId:x.workspaceId??null,profileCap:x.profileCap??null,expiresAt:x.expiresAt??null};
    this.db.prepare('INSERT INTO connectors(id,name,token_hash,created_at,workspace_id,profile_cap,expires_at) VALUES(?,?,?,?,?,?,?)').run(connector.id,connector.name,hash,connector.createdAt,connector.workspaceId,connector.profileCap,connector.expiresAt);
    return{connector,token};
  }
  list():ConnectorRecord[]{
    return this.db.prepare('SELECT id,name,created_at createdAt,last_used_at lastUsedAt,workspace_id workspaceId,profile_cap profileCap,expires_at expiresAt FROM connectors ORDER BY created_at').all() as unknown as ConnectorRecord[];
  }
  findByToken(token:string,now:number=Date.now()):ConnectorTokenRecord|null{
    const hash=ConnectorRepository.hash(token);
    const row=this.db.prepare('SELECT id,name,workspace_id workspaceId,profile_cap profileCap,expires_at expiresAt,token_hash tokenHash,previous_token_hash previousTokenHash,previous_expires_at previousExpiresAt FROM connectors WHERE token_hash=? OR (previous_token_hash IS NOT NULL AND previous_token_hash=?)').get(hash,hash) as any|undefined;
    if(!row)return null;
    const eq=(candidate:string)=>candidate!==''&&candidate.length===hash.length&&timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(candidate,'hex'));
    const isCurrent=eq(String(row.tokenHash??'')),isPrevious=eq(String(row.previousTokenHash??''));
    if(!isCurrent&&!isPrevious)return null;
    if(isPrevious&&(!row.previousExpiresAt||Date.parse(row.previousExpiresAt)<=now))return null; // grace expired
    if(row.expiresAt&&Date.parse(row.expiresAt)<=now)return null; // connector TTL expired
    return{id:String(row.id),name:String(row.name),workspaceId:row.workspaceId??null,profileCap:row.profileCap??null,expiresAt:row.expiresAt??null};
  }
  revoke(id:string){this.db.prepare('DELETE FROM connectors WHERE id=?').run(id);}
  rotate(id:string,graceMs:number=5*60_000):string|null{
    const row=this.db.prepare('SELECT token_hash,previous_expires_at previousExpiresAt FROM connectors WHERE id=?').get(id) as any|undefined;
    if(!row)return null;
    const token=randomBytes(16).toString('base64url');
    const now=Date.now();
    this.db.prepare('UPDATE connectors SET previous_token_hash=token_hash,previous_expires_at=?,token_hash=? WHERE id=?').run(new Date(now+graceMs).toISOString(),ConnectorRepository.hash(token),id);
    return token;
  }
  getBindings(id:string):{workspaceId:string|null;profileCap:string|null}|null{
    const row=this.db.prepare('SELECT workspace_id workspaceId,profile_cap profileCap FROM connectors WHERE id=?').get(id) as any|undefined;
    return row?{workspaceId:row.workspaceId??null,profileCap:row.profileCap??null}:null;
  }
  recordUse(id:string){
    const now=new Date().toISOString(),cutoff=new Date(Date.now()-60_000).toISOString();
    this.db.prepare('UPDATE connectors SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<?)').run(now,id,cutoff);
  }
  private static hash(token:string){return createHash('sha256').update(token).digest('hex');}
}
