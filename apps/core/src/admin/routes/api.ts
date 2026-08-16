import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Capability, RiskTier } from '../../../../../packages/protocol/src/index.js';

export interface AdminApiContext {
  workspaces?: any;
  approvals?: any;
  permissions?: any;
  sessions?: any;
  profiles?: any;
  bootstrap?: any;
  processes?: any;
  changes?: any;
  audit?: any;
  settings?: any;
  cloudflare?: any;
  oauth?: any;
  connectors?: any;
  metrics?: any;
  environment?: any;
  vault?: any;
  database?: any;
  safeMode?: () => boolean;
}

function send(res:ServerResponse,status:number,value:unknown,contentType='application/json'){
  res.statusCode=status;
  res.setHeader('content-type',contentType);
  res.end(contentType==='application/json'?JSON.stringify(value):String(value));
}

async function body(req:IncomingMessage){
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>1024*1024)throw Object.assign(new Error('request body too large'),{status:413});chunks.push(b);}
  if(!size)return{};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('invalid JSON'),{status:400});}
}

function criticalPersistentRule(input:any){
  if(input?.effect!=='allow'||!['workspace','global'].includes(input?.scope))return false;
  const m=String(input?.matcher??'').toLowerCase();
  return Boolean(input?.critical)||/workspace[_:-]?escape|privilege|elevat|security:disable|git:(?:reset|clean|force-push)|git:push.*force/.test(m);
}

function revision(context:AdminApiContext,key:string){return context.settings?.revision?.(key)??Date.now();}

const GUIDE_CHAPTERS=[
  {slug:'quick-start',title:'Quick start',file:'00-quick-start.md'},
  {slug:'install',title:'Install',file:'01-install.md'},
  {slug:'first-start',title:'First start',file:'02-first-start.md'},
  {slug:'remote-access',title:'Remote access',file:'03-remote-access.md'},
  {slug:'connect-chatgpt',title:'Connect ChatGPT',file:'04-connect-chatgpt.md'},
  {slug:'connect-claude',title:'Connect Claude',file:'05-connect-claude.md'},
  {slug:'connect-gemini',title:'Connect Gemini',file:'06-connect-gemini.md'},
  {slug:'workspaces',title:'Workspaces',file:'07-workspaces.md'},
  {slug:'permissions-approvals',title:'Permissions and approvals',file:'08-permissions-approvals.md'},
  {slug:'skills',title:'Skills',file:'09-skills.md'},
  {slug:'changes-recovery',title:'Changes and recovery',file:'10-changes-recovery.md'},
  {slug:'processes',title:'Processes',file:'11-processes.md'},
  {slug:'service',title:'Run as a service',file:'12-service.md'},
  {slug:'security-authentication',title:'Security and authentication',file:'13-security-authentication.md'},
  {slug:'troubleshooting',title:'Troubleshooting',file:'14-troubleshooting.md'},
  {slug:'explore',title:'Explore Aevra',file:'15-explore.md'},
] as const;
const DEFAULT_ONBOARDING={completed:false,completedSections:[] as string[]};
function onboardingState(value:any){
  const sections=Array.isArray(value?.completedSections)?value.completedSections.filter((x:any)=>typeof x==='string'&&x.length<=80).slice(0,32):[];
  return{completed:value?.completed===true,completedSections:[...new Set(sections)]};
}

export async function handleAdminApi(req:IncomingMessage,res:ServerResponse,url:URL,context:AdminApiContext):Promise<boolean>{
  const p=url.pathname,method=req.method??'GET';
  try{
    if(context.safeMode?.()&&!['GET','HEAD','OPTIONS'].includes(method)&&!p.startsWith('/api/config/')){send(res,503,{error:{code:'SAFE_MODE',message:'Administrative mutations are disabled while Aevra is in safe mode'}});return true;}
    if(p==='/api/workspaces'&&method==='GET'){send(res,200,context.workspaces?.listLocal?.()??context.workspaces?.listRemote?.()??[]);return true;}
    if(p==='/api/workspaces'&&method==='POST'){const x=await body(req);const value=context.workspaces.create({name:String(x.name),description:String(x.description??''),hostRoot:String(x.hostRoot)});send(res,200,{ok:true,revision:Date.now(),workspace:value});return true;}
    let m=p.match(/^\/api\/workspaces\/([^/]+)$/);
    if(m&&method==='PATCH'){const x=await body(req);const value=context.workspaces.update(m[1],x);send(res,200,{ok:true,revision:Date.now(),workspace:value});return true;}
    if(m&&method==='DELETE'){context.workspaces.delete(m[1]);send(res,200,{ok:true,revision:Date.now()});return true;}
    m=p.match(/^\/api\/workspaces\/([^/]+)\/mounts$/);
    if(m&&method==='GET'){send(res,200,context.workspaces?.listMountsLocal?.(m[1])??context.workspaces?.listMountsRemote?.(m[1])??[]);return true;}
    if(m&&method==='POST'){const x=await body(req);const mount=context.workspaces.addMount(m[1],{logicalPath:String(x.logicalPath),hostRoot:String(x.hostRoot),capabilities:(x.capabilities??[]) as Capability[],sensitivityPolicyId:x.sensitivityPolicyId});send(res,200,{ok:true,revision:Date.now(),mount});return true;}
    m=p.match(/^\/api\/mounts\/([^/]+)$/);if(m&&method==='DELETE'){context.workspaces.deleteMount(m[1]);send(res,200,{ok:true,revision:Date.now()});return true;}
    m=p.match(/^\/api\/workspaces\/([^/]+)\/admission$/);if(m&&method==='POST'){const x=await body(req);context.profiles?.mapActor?.(String(x.actor),m[1],String(x.profileId??'developer'),x.admission==='ask'?'ask':'auto');send(res,200,{ok:true,revision:Date.now()});return true;}

    if(p==='/api/approvals'&&method==='GET'){send(res,200,context.approvals?.list?.()??[]);return true;}
    m=p.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/);
    if(m&&method==='POST'){const x=await body(req);const scope=x.scope??'once';const ticket=m[2]==='approve'?context.approvals.approve(m[1],scope):context.approvals.deny(m[1]);if(m[2]==='approve'&&scope!=='once'&&ticket.risk!=='CRITICAL'&&context.permissions){const ruleScope=scope==='session'?'session':scope==='workspace'?'workspace':'global';context.permissions.upsert({id:`perm_${randomUUID()}`,effect:'allow',capability:ticket.operation.capability,scope:ruleScope,workspaceId:ruleScope==='workspace'?ticket.workspaceId:undefined,actor:ticket.actor,sessionId:ruleScope==='session'?ticket.sessionId:undefined,matcher:ticket.operation.family,createdAt:new Date().toISOString()});}send(res,200,{ok:true,revision:Date.now(),ticket});return true;}

    if(p==='/api/permissions'&&method==='GET'){send(res,200,context.permissions?.list?.()??[]);return true;}
    if(p==='/api/permissions'&&method==='POST'){const x=await body(req);if(criticalPersistentRule(x)){send(res,400,{error:{code:'CRITICAL_RULE_FORBIDDEN',message:'Critical operations cannot receive persistent always-allow rules'}});return true;}const rule={id:x.id??`perm_${randomUUID()}`,...x,createdAt:x.createdAt??new Date().toISOString()};context.permissions.upsert(rule);send(res,200,{ok:true,revision:Date.now(),rule});return true;}
    m=p.match(/^\/api\/permissions\/([^/]+)$/);if(m&&method==='DELETE'){context.permissions?.delete(m[1]);send(res,200,{ok:true,revision:Date.now()});return true;}

    if(p==='/api/sessions'&&method==='GET'){send(res,200,context.sessions?.list?.()??[]);return true;}
    m=p.match(/^\/api\/sessions\/([^/]+)\/revoke$/);if(m&&method==='POST'){context.sessions?.revoke?.(m[1]);send(res,200,{ok:true,revision:Date.now()});return true;}
    m=p.match(/^\/api\/sessions\/([^/]+)\/workspace$/);if(m&&method==='POST'){const x=await body(req);const result=await context.sessions?.switchWorkspace?.(m[1],String(x.workspaceId),x.profileId,x.timeoutMs);send(res,200,{ok:true,revision:Date.now(),result});return true;}
    if(p==='/api/admin-sessions'&&method==='GET'){send(res,200,context.bootstrap?.listSessions?.()??[]);return true;}
    m=p.match(/^\/api\/admin-sessions\/([^/]+)\/revoke$/);if(m&&method==='POST'){context.bootstrap?.revokeSessionHash?.(m[1]);send(res,200,{ok:true,revision:Date.now()});return true;}

    if(p==='/api/connectors'&&method==='GET'){send(res,200,context.connectors?.list?.()??[]);return true;}
    if(p==='/api/connectors'&&method==='POST'){const x=await body(req);const name=String(x.name??'').trim();if(!name){send(res,400,{error:{code:'INVALID_CONNECTOR',message:'Connector name is required'}});return true;}if(context.connectors?.list?.().some((c:any)=>c.name===name)){send(res,409,{error:{code:'CONNECTOR_EXISTS',message:`Connector ${name} already exists`}});return true;}let expiresAt:string|null=null;if(typeof x.expiresAt==='string'&&x.expiresAt){const t=Date.parse(x.expiresAt);if(Number.isNaN(t)){send(res,400,{error:{code:'INVALID_CONNECTOR',message:'expiresAt must be an ISO date'}});return true;}expiresAt=new Date(t).toISOString();}const {connector,token}=context.connectors.create({name,workspaceId:x.workspaceId?String(x.workspaceId):null,profileCap:x.profileCap?String(x.profileCap):null,expiresAt});context.audit?.append?.({actor:'admin',operation:'connector.create',target:name,result:'ok',redactionCount:0,class:'security'});send(res,201,{...connector,token});return true;}
    m=p.match(/^\/api\/connectors\/([^/]+)\/rotate$/);if(m&&method==='POST'){const token=context.connectors?.rotate?.(m[1]);if(!token){send(res,404,{error:{code:'NOT_FOUND',message:'Connector not found'}});return true;}const target=String(context.connectors?.list?.().find((c:any)=>c.id===m[1])?.name??m[1]);context.audit?.append?.({actor:'admin',operation:'connector.rotate',target,result:'ok',redactionCount:0,class:'security'});send(res,200,{ok:true,token});return true;}
    m=p.match(/^\/api\/connectors\/([^/]+)$/);if(m&&method==='DELETE'){const target=context.connectors?.list?.().find((c:any)=>c.id===m[1])?.name??m[1];context.connectors?.revoke?.(m[1]);context.audit?.append?.({actor:'admin',operation:'connector.revoke',target:String(target),result:'ok',redactionCount:0,class:'security'});send(res,200,{ok:true,revision:Date.now()});return true;}

    if(p==='/api/processes'&&method==='GET'){send(res,200,context.processes?.listLocal?.()??[]);return true;}
    m=p.match(/^\/api\/processes\/([^/]+)\/(stop|restart|forget)$/);if(m&&method==='POST'){const result=await context.processes?.localAction?.(m[1],m[2]);send(res,200,{ok:true,revision:Date.now(),result});return true;}

    if(p==='/api/changes'&&method==='GET'){send(res,200,context.changes?.list?.()??[]);return true;}
    m=p.match(/^\/api\/changes\/([^/]+)\/(commit|rollback)$/);if(m&&method==='POST'){const x=await body(req);const result=m[2]==='commit'?await context.changes.commit(m[1]):await context.changes.rollback(m[1],{force:Boolean(x.force),skipPaths:Array.isArray(x.skipPaths)?x.skipPaths:[]});send(res,200,{ok:true,revision:Date.now(),result});return true;}
    m=p.match(/^\/api\/changes\/([^/]+)$/);if(m&&method==='PATCH'){const x=await body(req);const result=context.changes?.rename?.(m[1],String(x.name??''));send(res,200,{ok:true,revision:Date.now(),result});return true;}

    if(p==='/api/metrics'&&method==='GET'){send(res,200,context.metrics?.snapshot?.()??[]);return true;}
    if(p==='/api/audit/verify'&&method==='GET'){send(res,200,context.audit?.verify?.()??{valid:false});return true;}
    if(p==='/api/audit/export'&&method==='GET'){const format=url.searchParams.get('format')==='jsonl'?'jsonl':'json';const text=format==='jsonl'?context.audit?.exportJsonl?.()??'':context.audit?.exportJson?.()??'[]';if(format==='jsonl')send(res,200,text,'application/x-ndjson');else send(res,200,JSON.parse(text),'application/json');return true;}

    if(p==='/api/policy/command-families'&&method==='GET'){send(res,200,context.settings?.get?.('command.family.overrides',{})??{});return true;}
    if(p==='/api/policy/command-families'&&method==='PATCH'){const x=await body(req);context.settings?.set?.('command.family.overrides',x);send(res,200,{ok:true,revision:context.settings?.revision?.('command.family.overrides')??1});return true;}
    if(p==='/api/policy/network-rules'&&method==='GET'){send(res,200,context.settings?.get?.('network.rules',[])??[]);return true;}
    if(p==='/api/policy/network-rules'&&method==='POST'){const x=await body(req),rules=context.settings?.get?.('network.rules',[])??[],host=String(x.host??'').toLowerCase();if(!host||host.includes('*')){send(res,400,{error:{code:'INVALID_NETWORK_RULE',message:'Network rule host must be explicit; wildcard hosts belong in the advanced permission editor'}});return true;}const protocol=String(x.protocol??'https').replace(':','').toLowerCase(),port=Number(x.port??443),rule={id:x.id??`net_${randomUUID()}`,effect:x.effect==='deny'?'deny':'allow',protocol,host,port,workspaceId:x.workspaceId??null};rules.push(rule);context.settings?.set?.('network.rules',rules);context.permissions?.upsert?.({id:`perm_${rule.id}`,effect:rule.effect,capability:'network',scope:rule.workspaceId?'workspace':'global',workspaceId:rule.workspaceId??undefined,matcher:`network.host:${protocol}:${host}:${port}`,createdAt:new Date().toISOString()});send(res,200,{ok:true,revision:context.settings?.revision?.('network.rules')??1,rule});return true;}
    m=p.match(/^\/api\/policy\/network-rules\/([^/]+)$/);if(m&&method==='DELETE'){const rules=(context.settings?.get?.('network.rules',[])??[]).filter((r:any)=>r.id!==m[1]);context.settings?.set?.('network.rules',rules);context.permissions?.delete?.(`perm_${m[1]}`);send(res,200,{ok:true,revision:context.settings?.revision?.('network.rules')??1});return true;}
    if(p==='/api/execution-settings'&&method==='GET'){send(res,200,context.settings?.get?.('execution.settings',{sandboxBackend:'auto',cachePolicy:'workspace',workspaceDrainMs:60000})??{});return true;}
    if(p==='/api/execution-settings'&&method==='PATCH'){const x=await body(req);context.settings?.set?.('execution.settings',x);if(x.workspaceDrainMs)context.settings?.set?.('workspace.drain.defaultMs',Number(x.workspaceDrainMs));send(res,200,{ok:true,revision:context.settings?.revision?.('execution.settings')??1});return true;}
    if(p==='/api/settings'&&method==='GET'){send(res,200,context.settings?.get?.('admin.settings',{})??{});return true;}
    if(p==='/api/settings'&&method==='PATCH'){const x=await body(req);const expected=Number(req.headers['if-match']??x.revision??-1),current=revision(context,'admin.settings');if(expected>=0&&expected!==current){send(res,409,{error:{code:'STALE_REVISION',current}});return true;}context.settings?.set?.('admin.settings',x.value??x);send(res,200,{ok:true,revision:revision(context,'admin.settings')});return true;}

    if(p==='/api/onboarding'&&method==='GET'){send(res,200,onboardingState(context.settings?.get?.('onboarding.state',DEFAULT_ONBOARDING)??DEFAULT_ONBOARDING));return true;}
    if(p==='/api/onboarding'&&method==='PATCH'){const x=await body(req);const state=onboardingState(x);context.settings?.set?.('onboarding.state',state);send(res,200,{ok:true,revision:revision(context,'onboarding.state'),state});return true;}
    if(p==='/api/guide'&&method==='GET'){send(res,200,GUIDE_CHAPTERS);return true;}
    if(p==='/api/oauth/requests'&&method==='GET'){send(res,200,context.oauth?.listPendingAuthorizations?.()??[]);return true;}
    m=p.match(/^\/api\/oauth\/requests\/([^/]+)\/(approve|deny)$/);
    if(m&&method==='POST'){const id=decodeURIComponent(m[1]);const decision=m[2];const value=decision==='approve'?context.oauth?.approveAuthorization?.(id):context.oauth?.denyAuthorization?.(id);if(!value){send(res,404,{error:{code:'OAUTH_REQUEST_NOT_FOUND',message:'OAuth authorization request not found'}});return true;}context.audit?.append?.({actor:'admin',operation:`oauth.authorize.${decision}`,target:id,result:'ok',redactionCount:0,class:'security'});send(res,200,{ok:true,request:value});return true;}

    if(p==='/api/cloudflare/status'&&method==='GET'){const detected=await context.cloudflare?.detectCloudflared?.();const auth=await context.cloudflare?.authenticationStatus?.();const cfg=context.settings?.get?.('cloudflare.config',null);const authMode=cfg?.authMode??(cfg?.issuer&&cfg?.audience?'access':'connector');send(res,200,{...(detected??{found:false}),authenticated:auth?.authenticated??false,authenticationMessage:auth?.message??'Cloudflare authentication has not been checked',ownership:context.cloudflare?.ownership?.()??'managed',authMode,...(cfg??{})});return true;}
    if(p==='/api/cloudflare/authenticate'&&method==='POST'){const result=await context.cloudflare?.authenticate?.();if(!result||result.code!==0)throw Object.assign(new Error(`cloudflared login failed: ${result?.stderr||result?.stdout||'unknown error'}`),{status:400});send(res,200,{ok:true,message:result.stdout||result.stderr||'Cloudflare authentication completed'});return true;}
    if(p==='/api/cloudflare/setup'&&method==='POST'){const x=await body(req);const result=await context.cloudflare.setup(x);if(result?.hostname)context.oauth?.setPublicBaseUrl?.(`https://${result.hostname}`);if(result?.ownership==='managed')await context.cloudflare?.startManagedTunnel?.();send(res,200,{ok:true,revision:Date.now(),result});return true;}
    if(p==='/api/cloudflare/test'&&method==='POST'){send(res,200,await context.cloudflare?.checkReachability?.()??{reachable:false,message:'Cloudflare manager unavailable'});return true;}

    if(p==='/api/secret-references'&&method==='GET'){send(res,200,context.environment?.listSecretRefs?.()??[]);return true;}
    if(p==='/api/secret-references'&&method==='POST'){const x=await body(req);const result=await context.environment?.setSecret?.(String(x.ref),String(x.value),'selected');send(res,200,{ok:true,revision:Date.now(),secret:{...result,value:undefined}});return true;}
    m=p.match(/^\/api\/secret-references\/([^/]+)$/);if(m&&method==='DELETE'){await context.environment?.deleteSecret?.(decodeURIComponent(m[1]));send(res,200,{ok:true,revision:Date.now()});return true;}
    if(p==='/api/environment-profiles'&&method==='GET'){send(res,200,context.environment?.list?.()??[]);return true;}
    if(p==='/api/environment-profiles'&&method==='POST'){const x=await body(req);const profile=context.environment.create(String(x.name),x.vars??{},x.secretRefs??{});send(res,200,{ok:true,revision:Date.now(),profile});return true;}
    if(p==='/api/vault/unlock'&&method==='POST'){const x=await body(req);context.vault?.unlock?.(String(x.passphrase??''));send(res,200,{ok:true,revision:Date.now()});return true;}
    if(p==='/api/vault/lock'&&method==='POST'){context.vault?.lock?.();send(res,200,{ok:true,revision:Date.now()});return true;}

    if(p==='/api/config/export'&&method==='GET'){send(res,200,context.database?.configExport?.(url.searchParams.get('portable')==='1')??{});return true;}
    if(p==='/api/config/import-preview'&&method==='POST'){const x=await body(req);send(res,200,context.database?.configPreview?.(x)??{adds:0,changes:0,pathRemaps:0,secretReconnects:0});return true;}
    return false;
  }catch(error){const e=error as any;send(res,e.status??400,{error:{code:e.code??'ADMIN_REQUEST_FAILED',message:e instanceof Error?e.message:String(e)}});return true;}
}
