import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AevraDatabase} from '../../store/src/database.js';
import {WorkspaceRepository} from '../../store/src/workspaces.js';
import {SessionRepository} from '../../store/src/sessions.js';
import {ApprovalRepository} from '../../store/src/approvals.js';
import {AuditRepository} from '../../store/src/audit.js';
import {WorkspaceService} from '../../../apps/core/src/workspaces/workspace-service.js';
import {CapabilityProfileService} from '../../../apps/core/src/policy/capabilities.js';
import {SessionManager} from '../../../apps/core/src/sessions/session-manager.js';
import {ReadVersionCache} from '../../../apps/core/src/operations/read-version-cache.js';
import {ApprovalService} from '../../../apps/core/src/approvals/approval-service.js';
import {AuditService} from '../../../apps/core/src/audit/audit-service.js';
import {McpToolService} from '../src/service.js';

function make(){
  const db=AevraDatabase.open(':memory:');const workspaces=new WorkspaceService(new WorkspaceRepository(db.raw()));const workspace=workspaces.create({name:'Aevra',hostRoot:mkdtempSync(path.join(os.tmpdir(),'aevra-cap-'))});const profiles=new CapabilityProfileService(db.raw());const sessions=new SessionManager(new SessionRepository(db.raw()),profiles);const approvals=new ApprovalService(new ApprovalRepository(db.raw()),new AuditService(new AuditRepository(db.raw())),{fastWaitMs:0,lifetimeMs:60_000,lifetimeByRiskMs:{}});approvals.setSessionIdentityResolver(id=>sessions.connectionIdentity(id));const writes:any[]=[];const operations:any={write:async(sessionId:string,input:any)=>{writes.push({sessionId,input});return{path:input.path,hash:'sha256:test'};},runCommand:async()=>({ok:true,value:{exitCode:0,signal:null,stdout:'ok',stderr:'',durationMs:1}}),classify:()=>({family:'npm:test',effect:'BUILD_OUTPUT',risk:'LOW',outputKeys:[]})};const service=new McpToolService(sessions,workspaces,{execute:async()=>({ok:true,value:{}})} as any,new ReadVersionCache(),approvals,{approvals,operations});return{db,workspace,profiles,sessions,approvals,service,writes};
}

test('read-only OAuth write requests one coding-session upgrade, reconnect reuses it, and approval resumes write',async()=>{
  const x=make();const identity={actor:'oauth:ChatGPT',subject:'grant-a',issuer:'https://example.test',audience:'https://example.test/mcp',expiresAt:new Date(Date.now()+60_000).toISOString()};const first=x.sessions.create(identity);x.sessions.grantConnectionWorkspace(first.id,x.workspace.id,'read-only');const blocked:any=await x.service.call(first.id,'file_write',{path:'/a.txt',content:'hello'});assert.equal(blocked.status,'approval_pending');const ticket=x.approvals.status(blocked.requestId)!;const payload=ticket.payload as any;assert.equal(ticket.operation.family,'workspace:capability-upgrade');assert.equal(payload.profileId,'coding-session');assert.deepEqual(payload.addedCapabilities.sort(),['commands.run','files.write']);assert.equal(x.writes.length,0);
  x.sessions.disconnect(first.id);const second=x.sessions.create(identity);assert.equal(x.sessions.activeLease(second.id)?.workspaceId,x.workspace.id,'workspace should restore before upgrade approval');const duplicate:any=await x.service.call(second.id,'file_write',{path:'/a.txt',content:'hello'});assert.equal(duplicate.requestId,blocked.requestId,'same OAuth grant and workspace must reuse one upgrade ticket');x.approvals.approve(ticket.id,'once');assert.ok(x.sessions.activeLease(second.id)?.capabilities.includes('files.write'));assert.ok(x.sessions.activeLease(second.id)?.capabilities.includes('commands.run'));const resumed:any=await x.service.call(second.id,'approval_wait',{requestId:ticket.id});assert.equal(resumed.path,'/a.txt');assert.equal(x.writes.length,1);x.db.close();
});

test('minimum profile ladder is coding-session, developer, then full-workspace',async()=>{
  const x=make();const s=x.sessions.create({actor:'oauth:ChatGPT',subject:'grant-b',issuer:'i',audience:'a',expiresAt:'x'});x.sessions.grantConnectionWorkspace(s.id,x.workspace.id,'read-only');const command:any=await x.service.call(s.id,'command_run',{executable:'npm',args:['test']});assert.equal((x.approvals.status(command.requestId)!.payload as any).profileId,'coding-session');x.approvals.deny(command.requestId);const commit:any=await x.service.call(s.id,'git_commit',{message:'x'});assert.equal((x.approvals.status(commit.requestId)!.payload as any).profileId,'developer');x.approvals.deny(commit.requestId);const del:any=await x.service.call(s.id,'file_delete',{path:'/a',recursive:false});assert.equal((x.approvals.status(del.requestId)!.payload as any).profileId,'full-workspace');x.db.close();
});

test('static connectors remain fixed-profile and do not auto-escalate',async()=>{
  const x=make();x.profiles.mapActor('connector:CLI',x.workspace.id,'read-only','auto');const s=x.sessions.create({actor:'connector:CLI',subject:'conn',issuer:'aevra:connector',audience:'aevra',expiresAt:'x'});const admission=await x.sessions.switchWorkspace(s.id,x.workspace.id);assert.equal(admission.status,'admitted');await assert.rejects(()=>x.service.call(s.id,'file_write',{path:'/a.txt',content:'x'}),/files\.write|CAPABILITY_REQUIRED/);assert.equal(x.approvals.list().filter(t=>t.operation.family==='workspace:capability-upgrade').length,0);x.db.close();
});
