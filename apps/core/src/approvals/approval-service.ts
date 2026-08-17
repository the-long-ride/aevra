import {randomUUID} from 'node:crypto';
import type {RiskTier,NormalizedOperation} from '../../../../packages/protocol/src/index.js';
import type {ApprovalRepository} from '../../../../packages/store/src/approvals.js';
import type {AuditService} from '../audit/audit-service.js';
import {notifySystem} from '../../../../packages/notifications/src/notify.js';

export type ApprovalState='PENDING'|'APPROVED'|'DENIED'|'EXPIRED'|'CANCELLED'|'EXECUTING'|'CONTEXT_CHANGED'|'SUCCEEDED'|'FAILED'|'INTERRUPTED';
export interface FrozenOperationTicket{id:string;actor:string;sessionId:string;workspaceId:string;operation:NormalizedOperation;payload?:unknown;expectedState:Record<string,string>;risk:RiskTier;state:ApprovalState;expiresAt:string;createdAt?:string;cancellationReason?:string;decisionScope?:string;}
export interface ApprovalConfig{fastWaitMs:number;lifetimeMs:number;lifetimeByRiskMs:Partial<Record<RiskTier,number>>;}
export type ResumeRevalidator=(ticket:FrozenOperationTicket)=>Promise<{ok:true}|{ok:false;reason:string}>;
export type ApprovedHandler=(ticket:FrozenOperationTicket)=>void;
export type SessionIdentityResolver=(sessionId:string)=>{actor:string;subject:string}|null;

export class ApprovalService{
  private approvedHandler?:ApprovedHandler;
  private sessionIdentityResolver?:SessionIdentityResolver;
  constructor(private repo:ApprovalRepository,private audit:AuditService,private config:ApprovalConfig){}

  setApprovedHandler(handler:ApprovedHandler){this.approvedHandler=handler;}
  setSessionIdentityResolver(resolver:SessionIdentityResolver){this.sessionIdentityResolver=resolver;}

  async request(input:Omit<FrozenOperationTicket,'id'|'state'|'expiresAt'>){
    const reusable=this.reusableWorkspaceRequest(input);
    if(reusable){
      const latest=this.status(reusable.id);
      if(latest?.state==='APPROVED')return{status:'approved' as const,requestId:latest.id};
      if(latest?.state==='PENDING')return{status:'approval_pending' as const,requestId:latest.id,expiresInSeconds:Math.max(0,Math.ceil((Date.parse(latest.expiresAt)-Date.now())/1000))};
    }
    const lifetime=this.config.lifetimeByRiskMs[input.risk]??this.config.lifetimeMs;
    const t:FrozenOperationTicket={...input,id:`req_${randomUUID()}`,state:'PENDING',expiresAt:new Date(Date.now()+lifetime).toISOString(),createdAt:new Date().toISOString()};
    this.repo.put(t);
    this.audit.append({actor:t.actor,sessionId:t.sessionId,workspaceId:t.workspaceId,operation:t.operation.family,risk:t.risk,decision:'approval_requested',result:'pending',redactionCount:0});
    notifySystem('Aevra approval required',`${t.operation.family} in workspace ${t.workspaceId}`);
    if(this.config.fastWaitMs>0)await new Promise(r=>setTimeout(r,this.config.fastWaitMs));
    const latest=this.status(t.id)!;
    if(latest.state==='APPROVED')return{status:'approved' as const,requestId:t.id};
    return{status:'approval_pending' as const,requestId:t.id,expiresInSeconds:Math.max(0,Math.ceil((Date.parse(t.expiresAt)-Date.now())/1000))};
  }

  list(){return this.repo.list().filter(Boolean) as FrozenOperationTicket[];}
  status(id:string):FrozenOperationTicket|null{
    const t=this.repo.get(id) as FrozenOperationTicket|null;
    if(t&&['PENDING','APPROVED'].includes(t.state)&&Date.parse(t.expiresAt)<=Date.now()){
      t.state='EXPIRED';this.repo.put(t);
      this.audit.append({actor:t.actor,sessionId:t.sessionId,workspaceId:t.workspaceId,operation:t.operation.family,risk:t.risk,decision:'expired',result:'APPROVAL_TIMEOUT',redactionCount:0});
    }
    return t;
  }
  approve(id:string,scope='once'){
    const t=this.required(id);if(t.state!=='PENDING')throw new Error(`Cannot approve ${t.state}`);
    t.state='APPROVED';t.decisionScope=scope;this.repo.put(t);
    this.audit.append({actor:t.actor,sessionId:t.sessionId,workspaceId:t.workspaceId,operation:t.operation.family,risk:t.risk,decision:`approved:${scope}`,result:'armed',redactionCount:0});
    this.approvedHandler?.(t);return t;
  }
  deny(id:string){const t=this.required(id);if(t.state!=='PENDING')throw new Error(`Cannot deny ${t.state}`);t.state='DENIED';this.repo.put(t);this.audit.append({actor:t.actor,sessionId:t.sessionId,workspaceId:t.workspaceId,operation:t.operation.family,risk:t.risk,decision:'denied',result:'APPROVAL_DENIED',redactionCount:0});return t;}
  cancel(id:string,reason='client_cancelled'){const t=this.required(id);if(!['PENDING','APPROVED'].includes(t.state))throw new Error(`Cannot cancel ${t.state}`);t.state='CANCELLED';t.cancellationReason=reason;this.repo.put(t);this.audit.append({actor:t.actor,sessionId:t.sessionId,workspaceId:t.workspaceId,operation:t.operation.family,risk:t.risk,decision:'cancelled',result:reason,redactionCount:0});return t;}
  cancelForRestart(){for(const t of this.repo.list().filter(Boolean) as FrozenOperationTicket[])if(['PENDING','APPROVED'].includes(t.state)){t.state='CANCELLED';t.cancellationReason='CANCELLED_RESTART';this.repo.put(t);this.audit.append({actor:t.actor,sessionId:t.sessionId,workspaceId:t.workspaceId,operation:t.operation.family,risk:t.risk,decision:'cancelled',result:'CANCELLED_RESTART',redactionCount:0});}}

  async resume<T>(id:string,revalidate:ResumeRevalidator,execute:(ticket:FrozenOperationTicket)=>Promise<T>){
    const t=this.required(id);
    if(t.state==='EXPIRED')throw Object.assign(new Error('APPROVAL_TIMEOUT'),{code:'APPROVAL_TIMEOUT'});
    if(t.state!=='APPROVED')throw Object.assign(new Error(`Approval is ${t.state}`),{code:t.state==='DENIED'?'APPROVAL_DENIED':'APPROVAL_PENDING'});
    const valid=await revalidate(t);
    if(!valid.ok){t.state='CONTEXT_CHANGED';this.repo.put(t);this.audit.append({actor:t.actor,sessionId:t.sessionId,workspaceId:t.workspaceId,operation:t.operation.family,risk:t.risk,decision:'resume_rejected',result:'APPROVAL_CONTEXT_CHANGED',redactionCount:0});throw Object.assign(new Error(valid.reason),{code:'APPROVAL_CONTEXT_CHANGED'});}
    t.state='EXECUTING';this.repo.put(t);this.audit.append({actor:t.actor,sessionId:t.sessionId,workspaceId:t.workspaceId,operation:t.operation.family,risk:t.risk,decision:'resume',result:'EXECUTING',redactionCount:0});
    try{const result=await execute(t);t.state='SUCCEEDED';this.repo.put(t);this.audit.append({actor:t.actor,sessionId:t.sessionId,workspaceId:t.workspaceId,operation:t.operation.family,risk:t.risk,decision:'resume',result:'SUCCEEDED',redactionCount:0});return result;}
    catch(e){t.state='FAILED';this.repo.put(t);this.audit.append({actor:t.actor,sessionId:t.sessionId,workspaceId:t.workspaceId,operation:t.operation.family,risk:t.risk,decision:'resume',result:'FAILED',redactionCount:0});throw e;}
  }

  private reusableWorkspaceRequest(input:Omit<FrozenOperationTicket,'id'|'state'|'expiresAt'>){
    if(input.operation.family!=='workspace:select'||!this.sessionIdentityResolver)return null;
    const current=this.sessionIdentityResolver(input.sessionId);if(!current)return null;
    return this.list().find(ticket=>{
      if(ticket.operation.family!=='workspace:select'||ticket.workspaceId!==input.workspaceId||ticket.actor!==input.actor||!['PENDING','APPROVED'].includes(ticket.state))return false;
      const existing=this.sessionIdentityResolver!(ticket.sessionId);
      return Boolean(existing&&existing.actor===current.actor&&existing.subject===current.subject);
    })??null;
  }
  private required(id:string){const t=this.status(id);if(!t)throw new Error('approval not found');return t;}
}
