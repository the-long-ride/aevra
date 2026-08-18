import assert from 'node:assert/strict';
import test from 'node:test';
import {AdminServer} from '../src/admin/server.js';

const bootstrap={validateSession:(value:string|undefined)=>value==='keep-me'} as any;

test('admin API lists configured OAuth connector actors before they have sessions',async()=>{
  const oauth={listClients:()=>[{clientId:'oauth_client_1',clientName:'ChatGPT',actor:'oauth:ChatGPT',redirectUris:['https://chatgpt.com/oauth/callback'],createdAt:'2026-08-18T00:00:00.000Z'}]};
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{oauth} as any});
  await server.start();
  try{
    const response=await fetch(`${server.url()}/api/oauth/clients`,{headers:{cookie:'aevra_admin=keep-me'}});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),oauth.listClients());
  }finally{await server.close();}
});
