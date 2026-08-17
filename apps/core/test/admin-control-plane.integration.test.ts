import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { WorkspaceRepository } from '../../../packages/store/src/workspaces.js';
import { WorkspaceService } from '../src/workspaces/workspace-service.js';
import { AdminServer } from '../src/admin/server.js';

async function request(url:string, init:RequestInit={}) {
  return fetch(url, { ...init, headers: { cookie:'aevra_admin=test', ...(init.headers??{}) } });
}

test('admin workspace mutations require same-origin request metadata', async () => {
  const db=AevraDatabase.open(':memory:');
  const workspaces=new WorkspaceService(new WorkspaceRepository(db.raw()));
  const bootstrap={validateSession:(v:string|undefined)=>v==='test'} as any;
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{workspaces} as any});
  await server.start();
  const denied=await request(`${server.url()}/api/workspaces`,{method:'POST',headers:{'content-type':'application/json','origin':'https://evil.example'},body:JSON.stringify({name:'A',hostRoot:'/tmp/a'})});
  assert.equal(denied.status,403);
  const allowed=await request(`${server.url()}/api/workspaces`,{method:'POST',headers:{'content-type':'application/json','origin':server.url(),'sec-fetch-site':'same-origin'},body:JSON.stringify({name:'A',hostRoot:'/tmp/a'})});
  assert.equal(allowed.status,200);
  const body=await allowed.json() as any;
  assert.equal(body.ok,true);
  assert.equal(workspaces.listRemote()[0]?.name,'A');
  await server.close();db.close();
});

test('approval allow route only arms the ticket and never executes it', async () => {
  let approved=0,executed=0;
  const bootstrap={validateSession:(v:string|undefined)=>v==='test'} as any;
  const approvals={approve(){approved++;return{id:'req_1',state:'APPROVED'}},deny(){throw new Error('unused')},status(){return null},list(){return[]}};
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{approvals,executeApproval:()=>executed++} as any});
  await server.start();
  const response=await request(`${server.url()}/api/approvals/req_1/approve`,{method:'POST',headers:{origin:server.url(),'sec-fetch-site':'same-origin'}});
  assert.equal(response.status,200);assert.equal(approved,1);assert.equal(executed,0);
  await server.close();
});

test('workspace admission approval is always one-time and never creates an operation permission rule', async () => {
  const bootstrap={validateSession:(v:string|undefined)=>v==='test'} as any;
  const scopes:string[]=[];let remembered=0;
  const ticket={id:'req_workspace',state:'APPROVED',risk:'MEDIUM',workspaceId:'ws_1',actor:'oauth:ChatGPT',sessionId:'ses_1',operation:{family:'workspace:select',capability:'files.read'}};
  const approvals={approve(_id:string,scope:string){scopes.push(scope);return ticket},deny(){throw new Error('unused')}};
  const permissions={upsert(){remembered++}};
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{approvals,permissions} as any});
  await server.start();
  const response=await request(`${server.url()}/api/approvals/req_workspace/approve`,{method:'POST',headers:{origin:server.url(),'sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({scope:'workspace'})});
  assert.equal(response.status,200);
  assert.deepEqual(scopes,['once']);
  assert.equal(remembered,0);
  await server.close();
});


test('admin Cloudflare workflow exposes authenticate and reachability actions', async () => {
  const bootstrap={validateSession:(v:string|undefined)=>v==='test'} as any;
  let authenticated=0,checked=0;
  const cloudflare={
    async authenticate(){authenticated++;return{code:0,stdout:'ok',stderr:''}},
    async checkReachability(){checked++;return{reachable:true,status:200,message:'reachable'}},
  };
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{cloudflare} as any});
  await server.start();
  const auth=await request(`${server.url()}/api/cloudflare/authenticate`,{method:'POST',headers:{origin:server.url(),'sec-fetch-site':'same-origin'}});
  assert.equal(auth.status,200);assert.equal(authenticated,1);
  const probe=await request(`${server.url()}/api/cloudflare/test`,{method:'POST',headers:{origin:server.url(),'sec-fetch-site':'same-origin'}});
  assert.equal(probe.status,200);assert.equal(checked,1);assert.deepEqual(await probe.json(),{reachable:true,status:200,message:'reachable'});
  await server.close();
});


test('admin Cloudflare setup starts a managed tunnel immediately', async () => {
  const bootstrap={validateSession:(v:string|undefined)=>v==='test'} as any;
  let starts=0;
  const cloudflare={
    async setup(){return{authMode:'connector',hostname:'mcp.example.com',tunnelId:'tid',ownership:'managed'}},
    async startManagedTunnel(){starts++;},
  };
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{cloudflare} as any});
  await server.start();
  const response=await request(`${server.url()}/api/cloudflare/setup`,{method:'POST',headers:{origin:server.url(),'sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({hostname:'mcp.example.com',authMode:'connector'})});
  assert.equal(response.status,200);assert.equal(starts,1);
  await server.close();
});


test('Cloudflare status resolves legacy no-Access config as connector mode', async () => {
  const bootstrap={validateSession:(v:string|undefined)=>v==='test'} as any;
  const settings={get:(key:string,fallback:any)=>key==='cloudflare.config'?{hostname:'mcp.example.com',tunnelId:'tid'}:fallback};
  const cloudflare={detectCloudflared:async()=>({found:true,version:'x'}),ownership:()=> 'managed'};
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{settings,cloudflare} as any});
  await server.start();
  const response=await request(`${server.url()}/api/cloudflare/status`);
  assert.equal(response.status,200);
  const value=await response.json() as any;
  assert.equal(value.authMode,'connector');assert.equal(value.hostname,'mcp.example.com');
  await server.close();
});

test('admin exposes OAuth pairing requests and local approve/deny actions', async () => {
  const bootstrap={validateSession:(v:string|undefined)=>v==='test'} as any;
  const pending=[{id:'oauth_req_1',clientId:'client_1',pairingCode:'ABCD-EFGH',requestedScopes:['mcp'],remoteIp:'203.0.113.4'}];
  const calls:string[]=[];
  const oauth={
    listPendingAuthorizations(){return pending},
    approveAuthorization(id:string){calls.push(`approve:${id}`);return {...pending[0],status:'approved'}},
    denyAuthorization(id:string){calls.push(`deny:${id}`);return {...pending[0],status:'denied'}},
  };
  const audit={append:(event:any)=>calls.push(`audit:${event.operation}:${event.target}`)};
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{oauth,audit} as any});
  await server.start();
  const list=await request(`${server.url()}/api/oauth/requests`);
  assert.equal(list.status,200);assert.deepEqual(await list.json(),pending);
  const approve=await request(`${server.url()}/api/oauth/requests/oauth_req_1/approve`,{method:'POST',headers:{origin:server.url(),'sec-fetch-site':'same-origin'}});
  assert.equal(approve.status,200);
  const deny=await request(`${server.url()}/api/oauth/requests/oauth_req_1/deny`,{method:'POST',headers:{origin:server.url(),'sec-fetch-site':'same-origin'}});
  assert.equal(deny.status,200);
  assert.deepEqual(calls,['approve:oauth_req_1','audit:oauth.authorize.approve:oauth_req_1','deny:oauth_req_1','audit:oauth.authorize.deny:oauth_req_1']);
  await server.close();
});

test('onboarding state persists through the admin API', async () => {
  const db=AevraDatabase.open(':memory:');
  const {SettingsRepository}=await import('../../../packages/store/src/settings.js');
  const settings=new SettingsRepository(db.raw());
  const bootstrap={validateSession:(v:string|undefined)=>v==='test'} as any;
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{settings} as any});
  await server.start();
  const first=await request(`${server.url()}/api/onboarding`);
  assert.deepEqual(await first.json(),{completed:false,completedSections:[]});
  const next={completed:false,completedSections:['local-gateway','remote-access']};
  const saved=await request(`${server.url()}/api/onboarding`,{method:'PATCH',headers:{origin:server.url(),'sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify(next)});
  assert.equal(saved.status,200);
  assert.deepEqual((await saved.json() as any).state,next);
  const loaded=await request(`${server.url()}/api/onboarding`);
  assert.deepEqual(await loaded.json(),next);
  await server.close();db.close();
});

test('guide manifest exposes the shipped onboarding manual chapters', async () => {
  const bootstrap={validateSession:(v:string|undefined)=>v==='test'} as any;
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{} as any});
  await server.start();
  const response=await request(`${server.url()}/api/guide`);
  assert.equal(response.status,200);
  const chapters=await response.json() as any[];
  assert.ok(chapters.length>=12);
  assert.equal(chapters[0].slug,'quick-start');
  assert.ok(chapters.some(x=>x.slug==='connect-chatgpt'&&x.file==='04-connect-chatgpt.md'));
  assert.ok(chapters.some(x=>x.slug==='security-authentication'));
  await server.close();
});

test('Cloudflare status reports an already authenticated cloudflared session', async () => {
  const bootstrap={validateSession:(v:string|undefined)=>v==='test'} as any;
  const settings={get:(_key:string,fallback:any)=>fallback};
  let logins=0;
  const cloudflare={
    detectCloudflared:async()=>({found:true,version:'cloudflared 2026.5.2'}),
    authenticationStatus:async()=>({authenticated:true,message:'Existing Cloudflare login is valid'}),
    authenticate:async()=>{logins++;return{code:0,stdout:'unused',stderr:''}},
    ownership:()=> 'managed',
  };
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{settings,cloudflare} as any});
  await server.start();
  const status=await request(`${server.url()}/api/cloudflare/status`);
  const value=await status.json() as any;
  assert.equal(value.authenticated,true);
  assert.match(value.authenticationMessage,/existing cloudflare login/i);
  const auth=await request(`${server.url()}/api/cloudflare/authenticate`,{method:'POST',headers:{origin:server.url(),'sec-fetch-site':'same-origin'}});
  assert.equal(auth.status,200);
  assert.equal(logins,1); // manager-level detection prevents the real CLI login; this fake verifies the endpoint remains callable.
  await server.close();
});
