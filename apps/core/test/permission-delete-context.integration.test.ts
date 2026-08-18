import assert from 'node:assert/strict';
import test from 'node:test';
import {AdminServer} from '../src/admin/server.js';

const bootstrap={validateSession:(value:string|undefined)=>value==='keep-me'} as any;

test('permission deletion returns removed actor context for the global toast',async()=>{
  let removed=false;
  const rule={id:'perm_1',actor:'connector:ChatGPT',capability:'files.write',matcher:'*'};
  const permissions={get:(id:string)=>id===rule.id?rule:null,delete:(id:string)=>{if(id===rule.id)removed=true;}};
  const server=new AdminServer('127.0.0.1',0,()=>({core:'running'}),{bootstrap,api:{permissions} as any});
  await server.start();
  try{
    const response=await fetch(`${server.url()}/api/permissions/perm_1`,{method:'DELETE',headers:{cookie:'aevra_admin=keep-me',origin:server.url(),'sec-fetch-site':'same-origin'}});
    assert.equal(response.status,200);assert.equal(removed,true);
    assert.deepEqual(await response.json(),{ok:true,removed:rule});
  }finally{await server.close();}
});
