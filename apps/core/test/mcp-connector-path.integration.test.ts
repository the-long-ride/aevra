import assert from 'node:assert/strict'; import test from 'node:test';
import {AevraDatabase} from '../../../packages/store/src/database.js';
import {SessionRepository} from '../../../packages/store/src/sessions.js';
import {CapabilityProfileService} from '../src/policy/capabilities.js';
import {SessionManager} from '../src/sessions/session-manager.js';
import {ConnectorRepository} from '../../../packages/store/src/connectors.js';
import {McpIngressServer} from '../src/mcp/server.js';
import type {RemoteIdentityVerifier,VerifiedRemoteIdentity} from '../src/auth/cloudflare.js';

function makeServer(db:AevraDatabase,options:{plainMcpEnabled?:boolean;verifier?:RemoteIdentityVerifier}={}){
  const raw=db.raw();
  const sessionsRepo=new SessionRepository(raw);
  const sessions=new SessionManager(sessionsRepo,new CapabilityProfileService(raw));
  const runtime:any={sessions,service:{call:async()=>({ok:true})}};
  const connectorsRepo=new ConnectorRepository(raw);
  const admission={verify:async(token:string)=>{
    const row=connectorsRepo.findByToken(token);
    if(!row)return{kind:'denied'} as const;
    connectorsRepo.recordUse(row.id);
    const identity:VerifiedRemoteIdentity={actor:`connector:${row.name}`,subject:row.id,issuer:'aevra:connector',audience:'aevra',expiresAt:new Date(Date.now()+24*3_600_000).toISOString()};
    return{kind:'admitted',identity} as const;
  }};
  return {server:new McpIngressServer('127.0.0.1',0,options.verifier as any,undefined,()=>false,runtime,admission,{plainMcpEnabled:options.plainMcpEnabled}),repo:connectorsRepo};
}

test('connector mode keeps plain /mcp closed while token endpoint works',async()=>{
  const db=AevraDatabase.open(':memory:');let verifierCalls=0;
  const verifier:any={async verifyRequest(){verifierCalls++;throw new Error('must not be called')}};
  const {server,repo}=makeServer(db,{plainMcpEnabled:false,verifier});
  await server.start();
  const plain=await fetch(`${server.url()}/mcp`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(plain.status,401);assert.equal(verifierCalls,0);
  const {token}=repo.create('ChatGPT');
  const tokenResponse=await fetch(`${server.url()}/mcp/${token}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}})});
  assert.equal(tokenResponse.status,200);
  await server.close();db.close();
});

test('Access mode permits plain /mcp through the configured verifier',async()=>{
  const db=AevraDatabase.open(':memory:');
  const identity:VerifiedRemoteIdentity={actor:'user@example.com',subject:'sub',issuer:'https://team.cloudflareaccess.com',audience:'aud',expiresAt:new Date(Date.now()+60_000).toISOString()};
  const {server}=makeServer(db,{plainMcpEnabled:true,verifier:{async verifyRequest(){return identity}}});
  await server.start();
  const r=await fetch(`${server.url()}/mcp`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}})});
  assert.equal(r.status,200);assert.ok(r.headers.get('mcp-session-id'));
  await server.close();db.close();
});

test('unknown and revoked tokens get identical 401 bodies',async()=>{const db=AevraDatabase.open(':memory:');const {server,repo}=makeServer(db,{plainMcpEnabled:false});await server.start();const {connector,token}=repo.create('temp');repo.revoke(connector.id);const a=await fetch(`${server.url()}/mcp/${token}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})});const b=await fetch(`${server.url()}/mcp/nope-nope-nope-nope`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})});assert.equal(a.status,401);assert.equal(b.status,401);assert.equal(await a.text(),await b.text());await server.close();db.close();});

test('non-mcp paths still 404 and health stays open',async()=>{const db=AevraDatabase.open(':memory:');const {server}=makeServer(db,{plainMcpEnabled:false});await server.start();assert.equal((await fetch(`${server.url()}/health`)).status,200);assert.equal((await fetch(`${server.url()}/other`)).status,404);await server.close();db.close();});
