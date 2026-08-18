import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
import {fileRead,fileList,fileSearch} from '../../executor/src/files.js';

function workerGateway(){return{async execute(i:any){const o=i.operation;return{ok:true,value:o.kind==='file.read'?await fileRead(o.path,i.roots):o.kind==='file.list'?await fileList(o.path,i.roots):await fileSearch(o.path,o.query,i.roots)}}};}
function approvalService(db:AevraDatabase){return new ApprovalService(new ApprovalRepository(db.raw()),new AuditService(new AuditRepository(db.raw())),{fastWaitMs:0,lifetimeMs:60_000,lifetimeByRiskMs:{}});}

test('select and read returns hash with no host path',async()=>{
  const d=mkdtempSync(path.join(os.tmpdir(),'aevra-mcp-'));writeFileSync(path.join(d,'a.txt'),'hello');const db=AevraDatabase.open(':memory:');const wr=new WorkspaceRepository(db.raw()),ws=new WorkspaceService(wr),w=ws.create({name:'W',hostRoot:d});const p=new CapabilityProfileService(db.raw());p.mapActor('a',w.id,'read-only','auto');const sessions=new SessionManager(new SessionRepository(db.raw()),p);const s=sessions.create({actor:'a',subject:'s',issuer:'i',audience:'x',expiresAt:'x'});const svc=new McpToolService(sessions,ws,workerGateway() as any,new ReadVersionCache());await svc.call(s.id,'workspace_select',{workspace:'W'});const r=await svc.call(s.id,'file_read',{path:'/a.txt'}) as any;assert.equal(r.content,'hello');assert.match(r.hash,/^sha256:/);assert.equal(JSON.stringify(r).includes(d),false);db.close();
});

test('unknown OAuth actor workspace selection creates one reusable read-only approval and resumes after approval',async()=>{
  const d=mkdtempSync(path.join(os.tmpdir(),'aevra-admission-'));const db=AevraDatabase.open(':memory:');const ws=new WorkspaceService(new WorkspaceRepository(db.raw()));const workspace=ws.create({name:'Aevra',hostRoot:d});const profiles=new CapabilityProfileService(db.raw());const sessions=new SessionManager(new SessionRepository(db.raw()),profiles);const session=sessions.create({actor:'oauth:ChatGPT',subject:'oauth-client',issuer:'https://example.test',audience:'https://example.test/mcp',expiresAt:new Date(Date.now()+60_000).toISOString()});const approvals=approvalService(db);approvals.setSessionIdentityResolver(id=>sessions.connectionIdentity(id));const svc=new McpToolService(sessions,ws,workerGateway() as any,new ReadVersionCache(),approvals,{approvals});
  const first=await svc.call(session.id,'workspace_select',{workspace:'Aevra'}) as any;assert.equal(first.status,'approval_pending');assert.match(first.requestId,/^req_/);assert.equal(first.workspace.id,workspace.id);let tickets=approvals.list().filter(ticket=>ticket.operation.family==='workspace:select');assert.equal(tickets.length,1);assert.equal(tickets[0]?.state,'PENDING');
  const second=await svc.call(session.id,'workspace_select',{workspace:'Aevra'}) as any;assert.equal(second.requestId,first.requestId);tickets=approvals.list().filter(ticket=>ticket.operation.family==='workspace:select');assert.equal(tickets.length,1);
  approvals.approve(first.requestId,'once');const selected=await svc.call(session.id,'approval_wait',{requestId:first.requestId}) as any;assert.equal(selected.status,'selected');assert.equal(selected.workspace.id,workspace.id);assert.ok(selected.capabilities.includes('files.read'));assert.equal(selected.capabilities.includes('commands.run'),false,'workspace access remains read-only until a coding upgrade is approved');assert.equal(sessions.activeLease(session.id)?.workspaceId,workspace.id);db.close();
});
