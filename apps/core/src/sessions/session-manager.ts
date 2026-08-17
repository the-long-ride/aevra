import {randomUUID} from 'node:crypto';
import type {Capability,Clock} from '../../../../packages/protocol/src/index.js';
import type {VerifiedRemoteIdentity} from '../auth/cloudflare.js';
import type {SessionRepository} from '../../../../packages/store/src/sessions.js';
import type {CapabilityProfileService} from '../policy/capabilities.js';

export interface SecuritySession{id:string;actor:string;subject:string;createdAt:string;lastActivityAt:string;remoteIp?:string;activeLeaseId?:string;}
export interface WorkspaceLease{id:string;sessionId:string;workspaceId:string;actor:string;capabilities:Capability[];expiresAt:string;}
const systemClock:Clock={now:()=>new Date()};

export class SessionManager{
  private sessions=new Map<string,SecuritySession>();
  private leases=new Map<string,WorkspaceLease>();
  private switching=new Set<string>();
  private connectionWorkspaceGrants=new Map<string,Map<string,string>>();
  private connectionActiveWorkspace=new Map<string,string>();
  private disconnectedIdentities=new Map<string,{actor:string;subject:string}>();
  private drain?: (sessionId:string,oldWorkspaceId:string,newWorkspaceId:string,timeoutMs?:number)=>Promise<void>;

  constructor(private repo:SessionRepository,private profiles:CapabilityProfileService,private idleMs=30*60_000,private clock:Clock=systemClock){}

  setSwitchDrainHandler(handler:(sessionId:string,oldWorkspaceId:string,newWorkspaceId:string,timeoutMs?:number)=>Promise<void>){this.drain=handler;}
  isSwitching(sessionId:string){return this.switching.has(sessionId);}

  async switchWorkspace(sessionId:string,workspaceId:string,overrideProfileId?:string,timeoutMs?:number){
    const old=this.activeLease(sessionId);
    this.switching.add(sessionId);
    try{
      if(old&&old.workspaceId!==workspaceId&&this.drain)await this.drain(sessionId,old.workspaceId,workspaceId,timeoutMs);
      return this.admitWorkspace(sessionId,workspaceId,overrideProfileId);
    }finally{this.switching.delete(sessionId);}
  }

  create(identity:VerifiedRemoteIdentity,remoteIp?:string):SecuritySession{
    const now=this.clock.now().toISOString();
    const s:SecuritySession={id:`ses_${randomUUID()}`,actor:identity.actor,subject:identity.subject,createdAt:now,lastActivityAt:now,...(remoteIp?{remoteIp}:{})};
    this.sessions.set(s.id,s);
    this.repo.create(s);
    this.restoreConnectionWorkspace(s);
    return s;
  }

  get(id:string){const s=this.sessions.get(id);if(!s)return null;return s;}
  list(){return[...this.sessions.values()].map(s=>({...s,lease:s.activeLeaseId?this.activeLease(s.id):null}));}
  revoke(id:string){this.disconnect(id);this.disconnectedIdentities.delete(id);this.repo.revoke?.(id);}

  touch(id:string){
    const s=this.sessions.get(id);if(!s)throw new Error('session not found');
    s.lastActivityAt=this.clock.now().toISOString();
    const l=s.activeLeaseId?this.leases.get(s.activeLeaseId):undefined;
    if(l)l.expiresAt=new Date(this.clock.now().getTime()+this.idleMs).toISOString();
    return s;
  }

  activeLease(sessionId:string){
    const s=this.sessions.get(sessionId);if(!s?.activeLeaseId)return null;
    const l=this.leases.get(s.activeLeaseId);if(!l)return null;
    if(Date.parse(l.expiresAt)<=this.clock.now().getTime()){this.revokeLease(l.id);return null;}
    return l;
  }

  grantConnectionWorkspace(sessionId:string,workspaceId:string,profileId:string):WorkspaceLease|null{
    const source=this.sessions.get(sessionId)??this.disconnectedIdentities.get(sessionId);
    if(!source)throw new Error('session identity not found');
    this.rememberConnectionWorkspace(source.subject,workspaceId,profileId);
    let granted:WorkspaceLease|null=null;
    for(const session of this.sessions.values()){
      if(session.subject!==source.subject||session.actor!==source.actor)continue;
      const admitted=this.admitWorkspace(session.id,workspaceId,profileId);
      if(admitted.status!=='admitted')throw new Error('connection workspace grant could not be admitted');
      if(session.id===sessionId||!granted)granted=admitted.lease;
    }
    return granted;
  }

  admitWorkspace(sessionId:string,workspaceId:string,overrideProfileId?:string):{status:'admitted';lease:WorkspaceLease}|{status:'approval-required'}{
    const s=this.sessions.get(sessionId);if(!s)throw new Error('session not found');
    const mapping=this.profiles.mapping(s.actor,workspaceId);
    const connectionProfileId=this.connectionWorkspaceGrants.get(s.subject)?.get(workspaceId);
    const oauthApproval=s.actor.startsWith('oauth:')&&overrideProfileId==='developer';
    let profileId=oauthApproval?(connectionProfileId??'read-only'):overrideProfileId;
    if(!profileId&&mapping?.admission==='auto')profileId=mapping.profileId;
    if(!profileId&&connectionProfileId)profileId=connectionProfileId;
    if(!profileId)return{status:'approval-required'};
    const profile=this.profiles.get(profileId);if(!profile)throw new Error('profile not found');
    if(s.activeLeaseId)this.revokeLease(s.activeLeaseId);
    const lease:WorkspaceLease={id:`lease_${randomUUID()}`,sessionId:s.id,workspaceId,actor:s.actor,capabilities:[...profile.capabilities],expiresAt:new Date(this.clock.now().getTime()+this.idleMs).toISOString()};
    this.leases.set(lease.id,lease);
    s.activeLeaseId=lease.id;
    this.repo.revokeSessionLeases(s.id);
    this.repo.saveLease(lease);
    if(oauthApproval)this.rememberConnectionWorkspace(s.subject,workspaceId,profileId);
    else if(connectionProfileId)this.connectionActiveWorkspace.set(s.subject,workspaceId);
    return{status:'admitted',lease};
  }

  revokeLease(id:string){
    const l=this.leases.get(id);if(!l)return;
    this.leases.delete(id);
    const s=this.sessions.get(l.sessionId);if(s?.activeLeaseId===id)delete s.activeLeaseId;
    this.repo.revokeSessionLeases(l.sessionId);
  }

  disconnect(sessionId:string){
    const s=this.sessions.get(sessionId);
    if(s?.actor.startsWith('oauth:'))this.disconnectedIdentities.set(sessionId,{actor:s.actor,subject:s.subject});
    if(s?.activeLeaseId)this.revokeLease(s.activeLeaseId);
    this.sessions.delete(sessionId);
  }

  invalidateForRestart(){
    this.sessions.clear();
    this.leases.clear();
    this.connectionWorkspaceGrants.clear();
    this.connectionActiveWorkspace.clear();
    this.disconnectedIdentities.clear();
    this.repo.invalidateAll();
  }

  private rememberConnectionWorkspace(subject:string,workspaceId:string,profileId:string){
    let grants=this.connectionWorkspaceGrants.get(subject);
    if(!grants){grants=new Map<string,string>();this.connectionWorkspaceGrants.set(subject,grants);}
    grants.set(workspaceId,profileId);
    this.connectionActiveWorkspace.set(subject,workspaceId);
  }

  private restoreConnectionWorkspace(session:SecuritySession){
    const workspaceId=this.connectionActiveWorkspace.get(session.subject);if(!workspaceId)return;
    const grants=this.connectionWorkspaceGrants.get(session.subject);
    const profileId=grants?.get(workspaceId);if(!profileId){this.connectionActiveWorkspace.delete(session.subject);return;}
    try{
      const admitted=this.admitWorkspace(session.id,workspaceId,profileId);
      if(admitted.status!=='admitted')this.connectionActiveWorkspace.delete(session.subject);
    }catch{
      grants?.delete(workspaceId);
      if(grants?.size===0)this.connectionWorkspaceGrants.delete(session.subject);
      this.connectionActiveWorkspace.delete(session.subject);
    }
  }
}
