import assert from 'node:assert/strict'; import test from 'node:test';
import {AevraDatabase} from '../../../packages/store/src/database.js';
import {SessionRepository} from '../../../packages/store/src/sessions.js';
import {CapabilityProfileService} from '../src/policy/capabilities.js';
import {SessionManager} from '../src/sessions/session-manager.js';
import {ConnectorRepository} from '../../../packages/store/src/connectors.js';
import {McpIngressServer} from '../src/mcp/server.js';
import {IpRateLimiter} from '../src/mcp/rate-limit.js';
import {handleJsonRpc} from '../../../packages/mcp-tools/src/register.js';

async function withServer(fn:(server:McpIngressServer,repo:ConnectorRepository)=>Promise<void>){
  const db=AevraDatabase.open(':memory:');const raw=db.raw();
  const sessions=new SessionManager(new SessionRepository(raw),new CapabilityProfileService(raw));
  const repo=new ConnectorRepository(raw);
  const server=new McpIngressServer('127.0.0.1',0,undefined as any,undefined,()=>false,{sessions,service:{call:async()=>({ok:true})}} as any,
    {verify:async(t:string)=>{const r=repo.findByToken(t);return r?{kind:'admitted',identity:{actor:`connector:${r.name}`,subject:r.id,issuer:'aevra:connector',audience:'aevra',expiresAt:new Date(Date.now()+3_600_000).toISOString()}} as const:{kind:'denied'} as const;}});
  await server.start();try{await fn(server,repo);}finally{await server.close();db.close();}
}
test('token brute force gets uniform 401 with no body differences',async()=>{await withServer(async(server)=>{
  const responses:string[]=[];
  for(const probe of ['a','ab','abc','abcdefghij1234567','zzzzzzzzzzzzzzzzzzzz']){const r=await fetch(`${server.url()}/mcp/${probe}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})});assert.equal(r.status,401);responses.push(await r.text());}
  assert.ok(responses.every(x=>x===responses[0]));
});});
test('safe mode blocks connector admission like /mcp',async()=>{
  const db=AevraDatabase.open(':memory:');const raw=db.raw();
  const sessions=new SessionManager(new SessionRepository(raw),new CapabilityProfileService(raw));
  const repo=new ConnectorRepository(raw);const {token}=repo.create('sm');
  const server=new McpIngressServer('127.0.0.1',0,undefined as any,undefined,()=>true,{sessions,service:{call:async()=>({})}} as any,{verify:async()=>({kind:'denied'} as const)});
  await server.start();
  const r=await fetch(`${server.url()}/mcp/${token}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})});
  assert.equal(r.status,503);await server.close();db.close();
});
test('remote MCP tool surface exposes no connector management',async()=>{
  const result=await handleJsonRpc({call:async()=>{throw new Error('unused')}} as any,'ses_x',{jsonrpc:'2.0',id:1,method:'tools/list'});
  const names=(result.result?.tools as any[]).map(t=>t.name);
  assert.equal(names.includes('aevra_status'),true);
  assert.equal(names.some(n=>n.startsWith('connector')),false);
});
test('exhausted rate limit returns 429 while below-threshold responses stay uniform',async()=>{
  const db=AevraDatabase.open(':memory:');const raw=db.raw();
  const sessions=new SessionManager(new SessionRepository(raw),new CapabilityProfileService(raw));
  const repo=new ConnectorRepository(raw);
  const limiter=new IpRateLimiter(5,0.001);
  const server=new McpIngressServer('127.0.0.1',0,undefined as any,undefined,()=>false,{sessions,service:{call:async()=>({})}} as any,
    {verify:async(t:string,ip:string)=>{if(!limiter.allow(ip))return{kind:'rate-limited'} as const;const r=repo.findByToken(t);if(!r){limiter.recordFailure(ip);return{kind:'denied'} as const;}return{kind:'admitted',identity:{actor:`connector:${r.name}`,subject:r.id,issuer:'aevra:connector',audience:'aevra',expiresAt:new Date(Date.now()+3_600_000).toISOString()}} as const;}});
  await server.start();
  const bodies:string[]=[];
  for(let i=0;i<5;i++){const r=await fetch(`${server.url()}/mcp/wrong-token-${i}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})});assert.equal(r.status,401);bodies.push(await r.text());}
  assert.ok(bodies.every(x=>x===bodies[0]),'below threshold: uniform 401 bodies');
  const throttled=await fetch(`${server.url()}/mcp/wrong-token-9`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})});
  assert.equal(throttled.status,429);
  assert.equal((await throttled.text()),'{"error":"rate_limited"}');
  assert.equal(limiter.totalFailures(),5);
  await server.close();db.close();
});
