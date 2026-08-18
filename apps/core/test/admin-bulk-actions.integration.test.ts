import assert from 'node:assert/strict';
import test from 'node:test';
import {AdminServer} from '../src/admin/server.js';

async function request(server:AdminServer,path:string,init:RequestInit={}){
  return fetch(`${server.url()}${path}`,{...init,headers:{cookie:'aevra_admin=keep-me',origin:server.url(),'sec-fetch-site':'same-origin','content-type':'application/json',...(init.headers??{})}});
}

const bootstrap={validateSession:(value:string|undefined)=>value==='keep-me'} as any;

test('bulk permission route expands capabilities into ordinary rule records',async()=>{
  const rules:any[]=[];
  const permissions={upsert:(rule:any)=>rules.push(rule)};
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{permissions} as any});
  await server.start();
  const response=await request(server,'/api/permissions/bulk',{method:'POST',body:JSON.stringify({effect:'allow',scope:'global',actors:['connector:ChatGPT'],capabilities:['files.write','commands.run']})});
  assert.equal(response.status,201);
  const value=await response.json() as any;
  assert.equal(value.count,2);
  assert.deepEqual(rules.map(rule=>[rule.actor,rule.capability,rule.scope,rule.matcher]),[
    ['connector:ChatGPT','files.write','global','*'],
    ['connector:ChatGPT','commands.run','global','*'],
  ]);
  await server.close();
});

test('workspace admissions route exposes mappings for the detail modal',async()=>{
  const profiles={listMappings:(workspaceId:string)=>[{actor:'connector:ChatGPT',workspaceId,profileId:'developer',profileName:'Developer',admission:'auto'}]};
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{profiles} as any});
  await server.start();
  const response=await request(server,'/api/workspaces/ws_1/admissions');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),[{actor:'connector:ChatGPT',workspaceId:'ws_1',profileId:'developer',profileName:'Developer',admission:'auto'}]);
  await server.close();
});

test('revoke-others keeps connector MCP sessions and the current admin session',async()=>{
  const revoked:string[]=[];let keptAdmin:string|undefined;
  const sessions={list:()=>[{id:'oauth_1',actor:'oauth:user'},{id:'connector_1',actor:'connector:ChatGPT'}],revoke:(id:string)=>revoked.push(id)};
  const localBootstrap={validateSession:(value:string|undefined)=>value==='keep-me',revokeAllExcept:(value:string|undefined)=>{keptAdmin=value;return{revoked:2,preserved:1}}};
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap:localBootstrap as any,api:{sessions,bootstrap:localBootstrap} as any});
  await server.start();
  const response=await request(server,'/api/sessions/revoke-others',{method:'POST',body:'{}'});
  assert.equal(response.status,200);
  assert.deepEqual(revoked,['oauth_1']);
  assert.equal(keptAdmin,'keep-me');
  assert.deepEqual(await response.json(),{ok:true,revokedRemote:1,preservedConnectors:1,revokedAdmin:2,preservedAdmin:1});
  await server.close();
});

test('audit history can be cleared through the admin API',async()=>{
  let clears=0;
  const audit={clear:()=>{clears++;return 7;}};
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{audit} as any});
  await server.start();
  const response=await request(server,'/api/audit',{method:'DELETE'});
  assert.equal(response.status,200);
  assert.equal(clears,1);
  assert.deepEqual(await response.json(),{ok:true,removed:7});
  await server.close();
});
