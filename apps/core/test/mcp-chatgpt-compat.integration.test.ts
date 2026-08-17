import assert from 'node:assert/strict';
import test from 'node:test';
import {McpIngressServer} from '../src/mcp/server.js';

const identity={actor:'test:chatgpt',subject:'chatgpt',issuer:'test',audience:'aevra',expiresAt:new Date(Date.now()+60_000).toISOString()};

test('MCP notifications/initialized is accepted without an invalid JSON-RPC response',async()=>{
  const sessions=new Map<string,any>();
  const runtime:any={
    sessions:{
      create(){const session={id:'session-1',...identity};sessions.set(session.id,session);return session;},
      get(id:string){return sessions.get(id);},
      touch(){},disconnect(id:string){sessions.delete(id);},
    },
    service:{},
  };
  const verifier:any={async verifyRequest(){return identity;}};
  const server=new McpIngressServer('127.0.0.1',0,verifier,undefined,()=>false,runtime);
  await server.start();
  try{
    const init=await fetch(`${server.url()}/mcp`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ChatGPT',version:'1'}}})});
    assert.equal(init.status,200);
    const sessionId=init.headers.get('mcp-session-id');assert.equal(sessionId,'session-1');
    const initialized=await fetch(`${server.url()}/mcp`,{method:'POST',headers:{'content-type':'application/json','mcp-session-id':sessionId!},body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
    assert.equal(initialized.status,202);
    assert.equal(await initialized.text(),'');
  }finally{await server.close();}
});

test('OAuth discovery responses are explicitly non-cacheable',async()=>{
  const oauth:any={
    issuer:'https://mcp.example.com',
    protectedResourceMetadata(){return{resource:'https://mcp.example.com/mcp',authorization_servers:['https://mcp.example.com']};},
    authorizationServerMetadata(){return{issuer:'https://mcp.example.com',authorization_endpoint:'https://mcp.example.com/oauth/authorize',token_endpoint:'https://mcp.example.com/oauth/token'};},
  };
  const server=new McpIngressServer('127.0.0.1',0,undefined,undefined,()=>false,undefined,undefined,{oauth});
  await server.start();
  try{
    for(const path of ['/.well-known/oauth-protected-resource/mcp','/.well-known/oauth-authorization-server']){
      const response=await fetch(`${server.url()}${path}`);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    }
  }finally{await server.close();}
});
