import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AevraDatabase} from '../../../packages/store/src/database.js';
import {OAuthRepository} from '../../../packages/store/src/oauth.js';
import {AevraOAuthService} from '../src/auth/oauth.js';

const b64url=(value:Buffer)=>value.toString('base64url');
const challenge=(verifier:string)=>b64url(createHash('sha256').update(verifier).digest());

function fixture(){
  let now=Date.parse('2026-08-17T12:00:00.000Z');
  const db=AevraDatabase.open(':memory:');
  const repo=new OAuthRepository(db.raw(),()=>new Date(now));
  const service=new AevraOAuthService(repo,{issuer:'https://mcp.example.com',resource:'https://mcp.example.com/mcp',now:()=>new Date(now)});
  return{db,repo,service,advance:(ms:number)=>{now+=ms;}};
}

test('OAuth discovery advertises MCP resource, DCR, PKCE S256, and offline access',()=>{
  const {db,service}=fixture();
  assert.deepEqual(service.protectedResourceMetadata(),{
    resource:'https://mcp.example.com/mcp',
    authorization_servers:['https://mcp.example.com'],
    bearer_methods_supported:['header'],
    scopes_supported:['mcp','offline_access'],
  });
  const metadata=service.authorizationServerMetadata();
  assert.equal(metadata.issuer,'https://mcp.example.com');
  assert.equal(metadata.authorization_endpoint,'https://mcp.example.com/oauth/authorize');
  assert.equal(metadata.token_endpoint,'https://mcp.example.com/oauth/token');
  assert.equal(metadata.registration_endpoint,'https://mcp.example.com/oauth/register');
  assert.deepEqual(metadata.code_challenge_methods_supported,['S256']);
  assert.equal(metadata.authorization_response_iss_parameter_supported,true);
  assert.ok(metadata.scopes_supported.includes('offline_access'));
  db.close();
});

test('DCR accepts public clients but authorization enforces exact redirect, resource, and PKCE S256',()=>{
  const {db,service}=fixture();
  const client=service.registerClient({client_name:'ChatGPT',redirect_uris:['https://chatgpt.com/oauth/callback'],token_endpoint_auth_method:'none',application_type:'web'});
  assert.equal(client.token_endpoint_auth_method,'none');
  assert.equal(client.application_type,'web');
  assert.throws(()=>service.registerClient({client_name:'Bad',redirect_uris:['http://evil.example/callback']}),/HTTPS or localhost/);
  const verifier='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  assert.throws(()=>service.beginAuthorization({client_id:client.client_id,redirect_uri:'https://attacker.example/cb',response_type:'code',scope:'mcp',resource:'https://mcp.example.com/mcp',code_challenge:challenge(verifier),code_challenge_method:'S256'},'203.0.113.4'),/redirect_uri/);
  assert.throws(()=>service.beginAuthorization({client_id:client.client_id,redirect_uri:'https://chatgpt.com/oauth/callback',response_type:'code',scope:'mcp',resource:'https://other.example/mcp',code_challenge:challenge(verifier),code_challenge_method:'S256'},'203.0.113.4'),/resource/);
  assert.throws(()=>service.beginAuthorization({client_id:client.client_id,redirect_uri:'https://chatgpt.com/oauth/callback',response_type:'code',scope:'mcp',resource:'https://mcp.example.com/mcp',code_challenge:challenge(verifier),code_challenge_method:'plain'},'203.0.113.4'),/S256/);
  db.close();
});

test('pending authorization list includes the registered client name for local approval',()=>{
  const {db,service}=fixture();
  const client=service.registerClient({client_name:'ChatGPT',redirect_uris:['https://chatgpt.com/oauth/callback']});
  const verifier='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  service.beginAuthorization({client_id:client.client_id,redirect_uri:client.redirect_uris[0]!,response_type:'code',scope:'mcp offline_access',resource:'https://mcp.example.com/mcp',code_challenge:challenge(verifier),code_challenge_method:'S256'},'203.0.113.4');
  const [pending]=service.listPendingAuthorizations();
  assert.equal(pending?.clientName,'ChatGPT');
  assert.equal(pending?.redirectUri,'https://chatgpt.com/oauth/callback');
  assert.deepEqual(pending?.requestedScopes,['mcp','offline_access']);
  db.close();
});

test('authorization waits for local approval before issuing a one-time code',()=>{
  const {db,service}=fixture();
  const client=service.registerClient({client_name:'ChatGPT',redirect_uris:['https://chatgpt.com/oauth/callback']});
  const verifier='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  const pending=service.beginAuthorization({client_id:client.client_id,redirect_uri:client.redirect_uris[0]!,response_type:'code',scope:'mcp offline_access',resource:'https://mcp.example.com/mcp',code_challenge:challenge(verifier),code_challenge_method:'S256',state:'opaque-state'},'203.0.113.4');
  assert.equal(service.authorizationStatus(pending.id).status,'PENDING');
  assert.throws(()=>service.continueAuthorization(pending.id),/not approved/);
  service.approveAuthorization(pending.id);
  const continued=service.continueAuthorization(pending.id);
  assert.equal(continued.redirectUrl.startsWith('https://chatgpt.com/oauth/callback?code='),true);
  assert.match(continued.redirectUrl,/state=opaque-state/);
  assert.equal(new URL(continued.redirectUrl).searchParams.get('iss'),'https://mcp.example.com');
  assert.throws(()=>service.continueAuthorization(pending.id),/not approved/);
  db.close();
});

test('authorization code exchange validates PKCE and issues rotating refresh token for offline_access',()=>{
  const {db,service}=fixture();
  const client=service.registerClient({client_name:'ChatGPT',redirect_uris:['https://chatgpt.com/oauth/callback']});
  const verifier='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  const pending=service.beginAuthorization({client_id:client.client_id,redirect_uri:client.redirect_uris[0]!,response_type:'code',scope:'mcp offline_access',resource:'https://mcp.example.com/mcp',code_challenge:challenge(verifier),code_challenge_method:'S256'},'203.0.113.4');
  service.approveAuthorization(pending.id);
  const {code}=service.continueAuthorization(pending.id);
  assert.throws(()=>service.exchangeAuthorizationCode({grant_type:'authorization_code',client_id:client.client_id,code,redirect_uri:client.redirect_uris[0]!,code_verifier:'wrong-verifier-that-is-long-enough-abcdefghijklmnopqrstuvwxyz',resource:'https://mcp.example.com/mcp'}),/PKCE/);

  const pending2=service.beginAuthorization({client_id:client.client_id,redirect_uri:client.redirect_uris[0]!,response_type:'code',scope:'mcp offline_access',resource:'https://mcp.example.com/mcp',code_challenge:challenge(verifier),code_challenge_method:'S256'},'203.0.113.4');
  service.approveAuthorization(pending2.id);
  const issued=service.continueAuthorization(pending2.id);
  const tokens=service.exchangeAuthorizationCode({grant_type:'authorization_code',client_id:client.client_id,code:issued.code,redirect_uri:client.redirect_uris[0]!,code_verifier:verifier,resource:'https://mcp.example.com/mcp'});
  assert.equal(tokens.token_type,'Bearer');
  assert.ok(tokens.access_token);
  assert.ok(tokens.refresh_token);
  assert.equal(service.verifyAccessToken(tokens.access_token).actor,'oauth:ChatGPT');
  assert.throws(()=>service.exchangeAuthorizationCode({grant_type:'authorization_code',client_id:client.client_id,code:issued.code,redirect_uri:client.redirect_uris[0]!,code_verifier:verifier,resource:'https://mcp.example.com/mcp'}),/invalid authorization code/);

  const refreshed=service.exchangeRefreshToken({grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token!,resource:'https://mcp.example.com/mcp'});
  assert.ok(refreshed.refresh_token);
  assert.notEqual(refreshed.refresh_token,tokens.refresh_token);
  assert.throws(()=>service.exchangeRefreshToken({grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token!,resource:'https://mcp.example.com/mcp'}),/invalid refresh token/);
  service.revoke(refreshed.refresh_token!);
  assert.throws(()=>service.exchangeRefreshToken({grant_type:'refresh_token',client_id:client.client_id,refresh_token:refreshed.refresh_token!,resource:'https://mcp.example.com/mcp'}),/invalid refresh token/);
  db.close();
});

test('OAuth public endpoint can be switched after Web-first tunnel setup',()=>{
  const {db,service}=fixture();
  service.setPublicBaseUrl('https://new.example.com');
  assert.equal(service.issuer,'https://new.example.com');
  assert.equal(service.resource,'https://new.example.com/mcp');
  assert.equal(service.protectedResourceMetadata().resource,'https://new.example.com/mcp');
  db.close();
});
