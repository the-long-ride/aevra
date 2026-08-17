import assert from 'node:assert/strict';
import test from 'node:test';
import {AevraDatabase} from '../../../packages/store/src/database.js';
import {SessionRepository} from '../../../packages/store/src/sessions.js';
import {WorkspaceRepository} from '../../../packages/store/src/workspaces.js';
import {ApprovalRepository} from '../../../packages/store/src/approvals.js';
import {AuditRepository} from '../../../packages/store/src/audit.js';
import {SessionManager} from '../src/sessions/session-manager.js';
import {WorkspaceService} from '../src/workspaces/workspace-service.js';
import {CapabilityProfileService} from '../src/policy/capabilities.js';
import {ApprovalService} from '../src/approvals/approval-service.js';
import {AuditService} from '../src/audit/audit-service.js';
import {ReadVersionCache} from '../src/operations/read-version-cache.js';
import {McpToolService} from '../../../packages/mcp-tools/src/service.js';

function fixture(){
  const db=AevraDatabase.open(':memory:');
  const workspaces=new WorkspaceService(new WorkspaceRepository(db.raw()));
  const aevra=workspaces.create({name:'Aevra',hostRoot:'/workspace/aevra'});
  const other=workspaces.create({name:'Other',hostRoot:'/workspace/other'});
  const sessions=new SessionManager(new SessionRepository(db.raw()),new CapabilityProfileService(db.raw()));
  const approvals=new ApprovalService(new ApprovalRepository(db.raw()),new AuditService(new AuditRepository(db.raw())),{fastWaitMs:0,lifetimeMs:60_000,lifetimeByRiskMs:{}});
  approvals.setApprovedHandler(ticket=>{
    if(ticket.operation.family==='workspace:select')sessions.grantConnectionWorkspace(ticket.sessionId,ticket.workspaceId,'read-only');
  });
  const worker={
    async execute(input:any){
      if(input.operation.kind==='file.list')return{ok:true,value:{path:input.operation.path,entries:[{name:'README.md',type:'file'}]}} as any;
      if(input.operation.kind==='file.search')return{ok:true,value:{matches:[]}} as any;
      if(input.operation.kind==='file.read')return{ok:true,value:{path:input.operation.path,hash:'hash',content:'hello'}} as any;
      return{ok:false,error:{code:'INVALID_REQUEST',message:'unexpected worker operation'}} as any;
    },
  };
  const tools=new McpToolService(sessions,workspaces,worker,new ReadVersionCache(),approvals);
  return{db,workspaces,aevra,other,sessions,approvals,tools};
}

const identity=(subject='oauth_grant_chatgpt')=>({subject,actor:'oauth:ChatGPT',issuer:'https://mcp.example.com',audience:'https://mcp.example.com/mcp',expiresAt:new Date(Date.now()+60_000).toISOString()});

test('approved workspace read access survives a fresh MCP security session without another request',async()=>{
  const f=fixture();
  const first=f.sessions.create(identity());
  const pending=await f.tools.call(first.id,'workspace_select',{workspace:'Aevra'}) as any;
  assert.equal(pending.status,'approval_pending');
  assert.ok(pending.requestId);
  f.approvals.approve(pending.requestId,'once');
  const selected=await f.tools.call(first.id,'approval_wait',{requestId:pending.requestId}) as any;
  assert.equal(selected.status,'selected');
  assert.deepEqual(selected.workspace,{id:f.aevra.id,name:'Aevra',description:''});
  assert.ok(selected.capabilities.includes('files.read'));
  assert.ok(selected.capabilities.includes('files.search'));
  assert.equal(selected.capabilities.includes('files.write'),false);
  assert.equal(selected.capabilities.includes('commands.run'),false);
  const firstList=await f.tools.call(first.id,'file_list',{path:'/'}) as any;
  assert.equal(firstList.entries[0].name,'README.md');

  f.sessions.disconnect(first.id);
  const second=f.sessions.create(identity());
  assert.notEqual(second.id,first.id);
  const current=await f.tools.call(second.id,'workspace_current') as any;
  assert.equal(current.id,f.aevra.id);
  const secondList=await f.tools.call(second.id,'file_list',{path:'/'}) as any;
  assert.equal(secondList.entries[0].name,'README.md');
  const workspaceTickets=f.approvals.list().filter(ticket=>ticket.operation.family==='workspace:select'&&ticket.workspaceId===f.aevra.id);
  assert.equal(workspaceTickets.length,1);
  f.db.close();
});

test('local Allow after an MCP reconnect grants the new session without creating another request',async()=>{
  const f=fixture();
  const first=f.sessions.create(identity());
  const pending=await f.tools.call(first.id,'workspace_select',{workspace:'Aevra'}) as any;
  assert.equal(pending.status,'approval_pending');
  f.sessions.disconnect(first.id);
  const second=f.sessions.create(identity());
  assert.equal(await f.tools.call(second.id,'workspace_current'),null);
  f.approvals.approve(pending.requestId,'once');
  const current=await f.tools.call(second.id,'workspace_current') as any;
  assert.equal(current.id,f.aevra.id);
  const listed=await f.tools.call(second.id,'file_list',{path:'/'}) as any;
  assert.equal(listed.entries[0].name,'README.md');
  const retried=await f.tools.call(second.id,'workspace_select',{workspace:'Aevra'}) as any;
  assert.equal(retried.status,'selected');
  assert.equal(f.approvals.list().filter(ticket=>ticket.operation.family==='workspace:select').length,1);
  f.db.close();
});

test('different OAuth authorization still requires workspace approval',async()=>{
  const f=fixture();
  const first=f.sessions.create(identity('oauth_grant_one'));
  const pending=await f.tools.call(first.id,'workspace_select',{workspace:'Aevra'}) as any;
  f.approvals.approve(pending.requestId,'once');
  await f.tools.call(first.id,'approval_wait',{requestId:pending.requestId});
  f.sessions.disconnect(first.id);
  const second=f.sessions.create(identity('oauth_grant_two'));
  assert.equal(await f.tools.call(second.id,'workspace_current'),null);
  const next=await f.tools.call(second.id,'workspace_select',{workspace:'Aevra'}) as any;
  assert.equal(next.status,'approval_pending');
  assert.notEqual(next.requestId,pending.requestId);
  f.db.close();
});

test('another workspace in the same OAuth authorization needs its own approval once',async()=>{
  const f=fixture();
  const session=f.sessions.create(identity());
  const first=await f.tools.call(session.id,'workspace_select',{workspace:'Aevra'}) as any;
  f.approvals.approve(first.requestId,'once');
  await f.tools.call(session.id,'approval_wait',{requestId:first.requestId});
  const other=await f.tools.call(session.id,'workspace_select',{workspace:'Other'}) as any;
  assert.equal(other.status,'approval_pending');
  assert.notEqual(other.requestId,first.requestId);
  f.approvals.approve(other.requestId,'once');
  const selected=await f.tools.call(session.id,'approval_wait',{requestId:other.requestId}) as any;
  assert.equal(selected.workspace.id,f.other.id);
  f.sessions.disconnect(session.id);
  const reconnected=f.sessions.create(identity());
  assert.equal((await f.tools.call(reconnected.id,'workspace_current') as any).id,f.other.id);
  const back=await f.tools.call(reconnected.id,'workspace_select',{workspace:'Aevra'}) as any;
  assert.equal(back.status,'selected');
  const tickets=f.approvals.list().filter(ticket=>ticket.operation.family==='workspace:select');
  assert.equal(tickets.length,2);
  f.db.close();
});
