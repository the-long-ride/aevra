import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AevraDatabase} from '../../../packages/store/src/database.js';
import {OAuthRepository} from '../../../packages/store/src/oauth.js';
import {ConnectorRepository} from '../../../packages/store/src/connectors.js';
import {AevraOAuthService} from '../src/auth/oauth.js';
import {McpIngressServer} from '../src/mcp/server.js';

const verifier='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
const challenge=createHash('sha256').update(verifier).digest('base64url');

function jsonHeaders(){return{'content-type':'application/json'};}

async function fixture(){
  const db=AevraDatabase.open(':memory:');
  const oauthRepo=new OAuthRepository(db.raw());
  const connectorRepo=new ConnectorRepository(db.raw());
  const oauth=new AevraOAuthService(oauthRepo,{issuer:'https://mcp.example.com',resource:'https://mcp.example.com/mcp'});
  const connectors={verify:async(token:string)=>{const row=connectorRepo.findByToken(token);return row?{kind:'admitted' as const,identity:{actor:`connector:${row.name}`,subject:row.id,issuer:'aevra:connector',audience:'aevra',expiresAt:new Date(Date.now()+60_000).toISOString()}}:{kind:'denied' as const};}};
  const identities:string[]=[];
  const server=new McpIngressServer('127.0.0.1',0,undefined,async(_req,res,identity)=>{identities.push(identity.actor);res.statusCode=200;res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,actor:identity.actor}));},()=>false,undefined,connectors,{oauth});
  await server.start();
  const addr=server.address();if(!addr||typeof addr==='string')throw new Error('no address');
  return{db,oauth,connectorRepo,server,base:`http://127.0.0.1:${addr.port}`,identities};
}

test('MCP OAuth discovery and 401 challenge advertise protected resource metadata',async()=>{
  const f=await fixture();
  const root=await fetch(`${f.base}/.well-known/oauth-protected-resource`);
  assert.equal(root.status,200);
  assert.equal((await root.json() as any).resource,'https://mcp.example.com/mcp');
  const pathMetadata=await fetch(`${f.base}/.well-known/oauth-protected-resource/mcp`);
  assert.equal(pathMetadata.status,200);
  const auth=await fetch(`${f.base}/.well-known/oauth-authorization-server`);
  assert.equal((await auth.json() as any).registration_endpoint,'https://mcp.example.com/oauth/register');
  const unauthorized=await fetch(`${f.base}/mcp`,{method:'POST',headers:jsonHeaders(),body:'{}'});
  assert.equal(unauthorized.status,401);
  assert.match(unauthorized.headers.get('www-authenticate')??'',/Bearer .*resource_metadata="https:\/\/mcp\.example\.com\/\.well-known\/oauth-protected-resource\/mcp"/);
  await f.server.close();f.db.close();
});

test('DCR + local approval + PKCE token exchange authenticates canonical /mcp',async()=>{
  const f=await fixture();
  const registration=await fetch(`${f.base}/oauth/register`,{method:'POST',headers:jsonHeaders(),body:JSON.stringify({client_name:'ChatGPT',redirect_uris:['https://chatgpt.com/oauth/callback'],token_endpoint_auth_method:'none'})});
  assert.equal(registration.status,201);
  const client=await registration.json() as any;
  const authorize=new URL(`${f.base}/oauth/authorize`);
  authorize.searchParams.set('client_id',client.client_id);authorize.searchParams.set('redirect_uri',client.redirect_uris[0]);authorize.searchParams.set('response_type','code');authorize.searchParams.set('scope','mcp offline_access');authorize.searchParams.set('resource','https://mcp.example.com/mcp');authorize.searchParams.set('code_challenge',challenge);authorize.searchParams.set('code_challenge_method','S256');authorize.searchParams.set('state','state123');
  const authPage=await fetch(authorize);
  assert.equal(authPage.status,200);
  const html=await authPage.text();
  const requestId=html.match(/data-request-id="([^"]+)"/)?.[1];
  assert.ok(requestId);
  assert.match(html,/Approve this connection in the local Aevra UI/);
  f.oauth.approveAuthorization(requestId!);
  const continued=await fetch(`${f.base}/oauth/authorize/continue?request_id=${encodeURIComponent(requestId!)}`,{redirect:'manual'});
  assert.equal(continued.status,302);
  const redirect=new URL(continued.headers.get('location')!);
  assert.equal(redirect.origin+redirect.pathname,'https://chatgpt.com/oauth/callback');
  assert.equal(redirect.searchParams.get('state'),'state123');
  const code=redirect.searchParams.get('code');assert.ok(code);
  const tokenBody=new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,code,redirect_uri:client.redirect_uris[0],code_verifier:verifier,resource:'https://mcp.example.com/mcp'});
  const tokenResponse=await fetch(`${f.base}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:tokenBody});
  assert.equal(tokenResponse.status,200);
  const tokens=await tokenResponse.json() as any;
  assert.ok(tokens.access_token);assert.ok(tokens.refresh_token);
  const mcp=await fetch(`${f.base}/mcp`,{method:'POST',headers:{...jsonHeaders(),authorization:`Bearer ${tokens.access_token}`},body:'{}'});
  assert.equal(mcp.status,200);
  assert.equal((await mcp.json() as any).actor,'oauth:ChatGPT');
  await f.server.close();f.db.close();
});

test('static connector Bearer works on /mcp while legacy path remains compatible',async()=>{
  const f=await fixture();
  const {token}=f.connectorRepo.create('Manual client');
  const bearer=await fetch(`${f.base}/mcp`,{method:'POST',headers:{...jsonHeaders(),authorization:`Bearer ${token}`},body:'{}'});
  assert.equal(bearer.status,200);
  assert.equal((await bearer.json() as any).actor,'connector:Manual client');
  const legacy=await fetch(`${f.base}/mcp/${token}`,{method:'POST',headers:jsonHeaders(),body:'{}'});
  assert.equal(legacy.status,200);
  assert.equal((await legacy.json() as any).actor,'connector:Manual client');
  await f.server.close();f.db.close();
});
