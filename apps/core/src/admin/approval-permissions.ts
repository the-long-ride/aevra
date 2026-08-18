import type {Capability,RiskTier} from '../../../../packages/protocol/src/index.js';

export interface ApprovalPermissionTicket{
  actor:string;
  sessionId:string;
  workspaceId:string;
  operation:{family:string;capability:Capability;risk:RiskTier};
  payload?:unknown;
  risk:RiskTier;
}

export function permissionRuleFromApproval(ticket:ApprovalPermissionTicket,scope:string,id:string,createdAt:string){
  if(scope==='once'||ticket.risk==='CRITICAL')return null;
  const ruleScope=scope==='session'?'session':scope==='workspace'?'workspace':scope==='global'?'global':null;
  if(!ruleScope)return null;
  const payload=ticket.payload as any;
  const matcher=payload?.tool==='capability_request'?String(payload.permissionMatcher??ticket.operation.family):ticket.operation.family;
  return{
    id,
    effect:'allow' as const,
    capability:ticket.operation.capability,
    scope:ruleScope,
    ...(ruleScope==='workspace'?{workspaceId:ticket.workspaceId}:{}),
    ...(ruleScope==='session'?{sessionId:ticket.sessionId}:{}),
    actor:ticket.actor,
    matcher,
    createdAt,
  };
}
