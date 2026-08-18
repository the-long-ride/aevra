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
import {handleJsonRpc} from '../src/register.js';

function fixture(profile='developer'){
  const db=AevraDatabase.open(':memory:');const workspaceRoot=mkdtempSync(path.join(os.tmpdir(),'aevra-shell-'));const workspaces=new WorkspaceService(new WorkspaceRepository(db.raw()));const workspace=workspaces.create({name:'Shell test',hostRoot:workspaceRoot});const profiles=new CapabilityProfileService(db.raw());profiles.mapActor('oauth:ChatGPT',workspace.id,profile,'auto');const sessions=new SessionManager(new SessionRepository(db.raw()),profiles);const session=sessions.create({actor:'oauth:ChatGPT',subject:`grant-${profile}`,issuer:'https://example.test',audience:'https://example.test/mcp',expiresAt:new Date(Date.now()+60_000).toISOString()});const approvals=new ApprovalService(new ApprovalRepository(db.raw()),new AuditService(new AuditRepository(db.raw())),{fastWaitMs:0,lifetimeMs:60_000,lifetimeByRiskMs:{}});approvals.setSessionIdentityResolver(id=>sessions.connectionIdentity(id));const executions:any[]=[];const operations={runCommand:async(...args:any[])=>{executions.push(args);return{ok:true,value:{exitCode:0,signal:null,stdout:'ok',stderr:'',durationMs:1}};},classify:()=>({family:'shell',effect:'UNKNOWN',risk:'LOW',outputKeys:[]})} as any;const service=new McpToolService(sessions,workspaces,{execute:async()=>({ok:true,value:{}})} as any,new ReadVersionCache(),approvals,{approvals,operations});return{db,workspace,sessions,session,approvals,executions,service};
}

test('shell_run requires high-risk local approval and resumes through command_run',async()=>{
  const x=fixture();await x.service.call(x.session.id,'workspace_select',{workspace:x.workspace.id});const pending:any=await handleJsonRpc(x.service,x.session.id,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'shell_run',arguments:{script:'pwd'}}});assert.equal(pending.result.structuredContent.status,'approval_pending');const ticket=x.approvals.status(pending.result.structuredContent.requestId)!;assert.equal(ticket.risk,'HIGH');assert.equal(ticket.operation.family,'shell:bash');assert.equal(x.executions.length,0,'shell must not execute before local approval');x.approvals.approve(ticket.id,'once');const resumed:any=await handleJsonRpc(x.service,x.session.id,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'approval_wait',arguments:{requestId:ticket.id}}});assert.equal(x.executions.length,1);assert.equal(x.executions[0][1].executable,'bash');assert.deepEqual(x.executions[0][1].args,['-lc','pwd']);assert.equal(x.executions[0][2],'sandbox');assert.equal(resumed.result.structuredContent.ok,true);x.db.close();
});

test('read-only shell request asks once for the exact commands.run matcher and preserves env and timeout',async()=>{
  const x=fixture('read-only');await x.service.call(x.session.id,'workspace_select',{workspace:x.workspace.id});const first:any=await x.service.call(x.session.id,'shell_run',{script:'echo "$NAME"',env:{NAME:'aevra'},timeoutMs:4321});assert.equal(first.status,'approval_pending');const ticket=x.approvals.status(first.requestId)!;const payload=ticket.payload as any;assert.equal(ticket.operation.family,'shell:bash');assert.equal(ticket.operation.capability,'commands.run');assert.equal(payload.tool,'capability_request');assert.equal(payload.requestedCapability,'commands.run');assert.equal(payload.permissionMatcher,'shell:bash');assert.equal(payload.profileId,undefined);assert.equal(x.executions.length,0);x.approvals.approve(ticket.id,'once');await x.service.call(x.session.id,'approval_wait',{requestId:ticket.id});assert.equal(x.executions.length,1);assert.equal(x.executions[0][1].timeoutMs,4321);assert.equal(x.executions[0][1].env.NAME,'aevra');assert.deepEqual(x.executions[0][1].args,['-lc','echo "$NAME"']);assert.ok(!x.sessions.activeLease(x.session.id)?.capabilities.includes('commands.run'),'exact approval must not mutate the read-only profile');x.db.close();
});
