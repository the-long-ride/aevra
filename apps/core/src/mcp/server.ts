import http,{type IncomingMessage,type ServerResponse} from 'node:http';
import https,{type ServerOptions as HttpsServerOptions} from 'node:https';
import {AEVRA_VERSION} from '../version.js';
import {RejectingIdentityVerifier,type RemoteIdentityVerifier,type VerifiedRemoteIdentity} from '../auth/cloudflare.js';
import type {AevraOAuthService} from '../auth/oauth.js';
import {handleJsonRpc} from '../../../../packages/mcp-tools/src/register.js';

export type McpRequestHandler=(request:IncomingMessage,response:ServerResponse,identity:VerifiedRemoteIdentity)=>Promise<void>;
export interface McpSessionRuntime{sessions:any;service:any;}
export type ConnectorAdmissionOutcome={kind:'admitted';identity:VerifiedRemoteIdentity}|{kind:'denied'}|{kind:'rate-limited'};
export interface ConnectorAdmission{verify(token:string,ip:string):Promise<ConnectorAdmissionOutcome>;}
export interface McpIngressServerOptions{tls?:HttpsServerOptions;advertisedHost?:string;plainMcpEnabled?:boolean;oauth?:AevraOAuthService;}

const LEGACY_PROTOCOL_VERSIONS=['2025-11-25','2025-06-18','2025-03-26'] as const;
const MODERN_PROTOCOL_VERSION='2026-07-28';

async function readText(req:IncomingMessage){const chunks:Buffer[]=[];let size=0;for await(const c of req){const b=Buffer.from(c);size+=b.length;if(size>1024*1024)throw new Error('MCP request too large');chunks.push(b);}return Buffer.concat(chunks).toString('utf8');}
async function readJson(req:IncomingMessage){const text=await readText(req);return text?JSON.parse(text):{};}
function send(res:ServerResponse,status:number,value:unknown){res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(value));}
function sendHtml(res:ServerResponse,status:number,html:string){res.statusCode=status;res.setHeader('content-type','text/html; charset=utf-8');res.setHeader('cache-control','no-store');res.end(html);}
function sendOAuthJson(res:ServerResponse,status:number,value:unknown){res.setHeader('cache-control','no-store');send(res,status,value);}
function remoteIp(req:IncomingMessage){return typeof req.headers['cf-connecting-ip']==='string'?req.headers['cf-connecting-ip']:req.socket.remoteAddress;}
function bearer(req:IncomingMessage){const value=req.headers.authorization;if(typeof value!=='string')return undefined;const match=value.match(/^Bearer\s+(.+)$/i);return match?.[1]?.trim();}
function h(value:unknown){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
function protocolHeader(req:IncomingMessage){const value=req.headers['mcp-protocol-version'];return typeof value==='string'?value.trim():undefined;}
function protocolMeta(body:any){const value=body?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];return typeof value==='string'?value.trim():undefined;}
function requestedProtocol(req:IncomingMessage,body:any){return protocolHeader(req)??protocolMeta(body);}
function legacyProtocol(requested:unknown){const value=typeof requested==='string'?requested:'';return LEGACY_PROTOCOL_VERSIONS.includes(value as any)?value:LEGACY_PROTOCOL_VERSIONS[0];}
function unsupportedProtocol(res:ServerResponse,id:unknown,requested:string){send(res,400,{jsonrpc:'2.0',id:id??null,error:{code:-32602,message:'Unsupported protocol version',data:{supported:[...LEGACY_PROTOCOL_VERSIONS],requested}}});}

export class McpIngressServer{
  private server?:http.Server|https.Server;
  constructor(private host:string,private port:number,private verifier:RemoteIdentityVerifier=new RejectingIdentityVerifier(),private handler?:McpRequestHandler,private safeMode:()=>boolean=()=>false,private runtime?:McpSessionRuntime,private connectors?:ConnectorAdmission,private options:McpIngressServerOptions={}){}
  async start(){this.server=this.options.tls?https.createServer(this.options.tls,(req,res)=>void this.handle(req,res)):http.createServer((req,res)=>void this.handle(req,res));await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(this.port,this.host,resolve)});const a=this.server.address();if(a&&typeof a!=='string')this.port=a.port;}
  address(){return this.server?.address();}
  url(){return `${this.options.tls?'https':'http'}://${this.options.advertisedHost??this.host}:${this.port}`;}
  async close(){if(!this.server)return;await new Promise<void>(r=>this.server!.close(()=>r()));this.server=undefined;}
  private async handle(req:IncomingMessage,res:ServerResponse){
    const url=new URL(req.url??'/',this.url()),path=url.pathname;
    if(path==='/health'){res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');res.end(JSON.stringify({ok:true}));return;}
    if(await this.handleOAuth(req,res,url))return;
    const connectorMatch=path.match(/^\/mcp\/([A-Za-z0-9_-]+)$/);
    if(path!=='/mcp'&&!connectorMatch){res.statusCode=404;res.end('Not Found');return;}
    if(this.safeMode()){send(res,503,{error:'SAFE_MODE'});return;}
    let identity:VerifiedRemoteIdentity;
    if(connectorMatch){
      const outcome=await this.verifyConnector(connectorMatch[1]!,req);
      if(outcome.kind==='rate-limited'){send(res,429,{error:'rate_limited'});return;}
      if(outcome.kind!=='admitted'){this.unauthorized(res);return;}
      identity=outcome.identity;
    }else{
      const bearerToken=bearer(req);
      if(bearerToken){
        const bearerIdentity=await this.verifyBearerToken(bearerToken,req);
        if(!bearerIdentity){this.unauthorized(res);return;}
        identity=bearerIdentity;
      }else{
        if(this.options.plainMcpEnabled===false){this.unauthorized(res);return;}
        try{identity=await this.verifier.verifyRequest(req);}catch{this.unauthorized(res);return;}
      }
    }
    if(this.handler){await this.handler(req,res,identity);return;}
    if(!this.runtime){send(res,501,{error:'MCP tools not wired'});return;}
    try{
      const sidHeader=req.headers['mcp-session-id'];const sid=typeof sidHeader==='string'?sidHeader:undefined;
      if(req.method==='DELETE'){
        if(!sid){send(res,400,{error:'MCP session id required'});return;}
        if(!this.sameIdentity(sid,identity)){send(res,404,{error:'MCP session not found'});return;}
        this.runtime.sessions.disconnect(sid);res.statusCode=204;res.end();return;
      }
      if(req.method!=='POST'){send(res,405,{error:'method not allowed'});return;}
      const body=await readJson(req);
      const protocol=requestedProtocol(req,body);
      if(protocol===MODERN_PROTOCOL_VERSION){unsupportedProtocol(res,body?.id,protocol);return;}
      if(body?.method==='server/discover'){
        unsupportedProtocol(res,body?.id,protocol||MODERN_PROTOCOL_VERSION);return;
      }
      if(body?.method==='initialize'){
        const session=this.runtime.sessions.create(identity,remoteIp(req));
        res.setHeader('mcp-session-id',session.id);
        send(res,200,{jsonrpc:'2.0',id:body.id??null,result:{protocolVersion:legacyProtocol(body.params?.protocolVersion),capabilities:{tools:{listChanged:false},resources:{listChanged:false},prompts:{listChanged:false}},serverInfo:{name:'Aevra',version:AEVRA_VERSION}}});
        return;
      }
      if(!sid){send(res,400,{error:'MCP session id required'});return;}
      if(!this.sameIdentity(sid,identity)){send(res,404,{error:'MCP session not found'});return;}
      this.runtime.sessions.touch(sid);
      if(body?.id===undefined&&typeof body?.method==='string'&&body.method.startsWith('notifications/')){res.statusCode=202;res.setHeader('cache-control','no-store');res.end();return;}
      send(res,200,await handleJsonRpc(this.runtime.service,sid,body));
    }catch(e){send(res,(e as any)?.status??400,{error:e instanceof Error?e.message:String(e)});}
  }

  private async verifyBearerToken(token:string,req:IncomingMessage):Promise<VerifiedRemoteIdentity|null>{
    if(this.options.oauth){try{return this.options.oauth.verifyAccessToken(token);}catch{/* try static connector */}}
    const connector=await this.verifyConnector(token,req);
    return connector.kind==='admitted'?connector.identity:null;
  }
  private async verifyConnector(token:string,req:IncomingMessage):Promise<ConnectorAdmissionOutcome>{
    if(!this.connectors)return{kind:'denied'};
    return this.connectors.verify(token,remoteIp(req));
  }
  private unauthorized(res:ServerResponse){
    if(this.options.oauth){const metadata=`${this.options.oauth.issuer}/.well-known/oauth-protected-resource/mcp`;res.setHeader('www-authenticate',`Bearer resource_metadata="${metadata}", scope="mcp"`);}
    send(res,401,{error:'unauthorized'});
  }

  private async handleOAuth(req:IncomingMessage,res:ServerResponse,url:URL):Promise<boolean>{
    const oauth=this.options.oauth;if(!oauth)return false;
    const path=url.pathname,method=req.method??'GET';
    if((path==='/.well-known/oauth-protected-resource'||path==='/.well-known/oauth-protected-resource/mcp')&&method==='GET'){sendOAuthJson(res,200,oauth.protectedResourceMetadata());return true;}
    if((path==='/.well-known/oauth-authorization-server'||path==='/.well-known/oauth-authorization-server/mcp')&&method==='GET'){sendOAuthJson(res,200,oauth.authorizationServerMetadata());return true;}
    if(path==='/oauth/register'&&method==='POST'){
      try{const input=await readJson(req);sendOAuthJson(res,201,oauth.registerClient(input));}catch(e){sendOAuthJson(res,400,{error:'invalid_client_metadata',error_description:e instanceof Error?e.message:String(e)});}return true;
    }
    if(path==='/oauth/authorize'&&method==='GET'){
      try{
        const pending=oauth.beginAuthorization({client_id:url.searchParams.get('client_id')??'',redirect_uri:url.searchParams.get('redirect_uri')??'',response_type:url.searchParams.get('response_type')??'',scope:url.searchParams.get('scope')??undefined,resource:url.searchParams.get('resource')??undefined,code_challenge:url.searchParams.get('code_challenge')??'',code_challenge_method:url.searchParams.get('code_challenge_method')??'',state:url.searchParams.get('state')??undefined},remoteIp(req));
        sendHtml(res,200,this.authorizationPage(pending.id,pending.pairingCode));
      }catch(e){sendHtml(res,400,`<!doctype html><meta charset="utf-8"><title>Aevra authorization</title><body style="font-family:system-ui;background:#0a0a0a;color:#fff;padding:32px"><h1>Connection request rejected</h1><p>${h(e instanceof Error?e.message:String(e))}</p></body>`);}return true;
    }
    if(path==='/oauth/authorize/status'&&method==='GET'){
      const status=oauth.authorizationStatus(url.searchParams.get('request_id')??'');sendOAuthJson(res,200,{status:status.status});return true;
    }
    if(path==='/oauth/authorize/continue'&&method==='GET'){
      try{const result=oauth.continueAuthorization(url.searchParams.get('request_id')??'');res.statusCode=302;res.setHeader('location',result.redirectUrl);res.setHeader('cache-control','no-store');res.end();}catch(e){sendHtml(res,409,`<!doctype html><meta charset="utf-8"><title>Aevra authorization</title><body style="font-family:system-ui;background:#0a0a0a;color:#fff;padding:32px"><h1>Authorization unavailable</h1><p>${h(e instanceof Error?e.message:String(e))}</p></body>`);}return true;
    }
    if(path==='/oauth/token'&&method==='POST'){
      try{
        const form=new URLSearchParams(await readText(req)),grant=form.get('grant_type');
        const result=grant==='authorization_code'?oauth.exchangeAuthorizationCode({grant_type:'authorization_code',client_id:form.get('client_id')??'',code:form.get('code')??'',redirect_uri:form.get('redirect_uri')??'',code_verifier:form.get('code_verifier')??'',resource:form.get('resource')??''}):grant==='refresh_token'?oauth.exchangeRefreshToken({grant_type:'refresh_token',client_id:form.get('client_id')??'',refresh_token:form.get('refresh_token')??'',resource:form.get('resource')??'',scope:form.get('scope')??undefined}):(()=>{throw new Error('unsupported grant_type');})();
        sendOAuthJson(res,200,result);
      }catch(e){sendOAuthJson(res,400,{error:'invalid_grant',error_description:e instanceof Error?e.message:String(e)});}return true;
    }
    if(path==='/oauth/revoke'&&method==='POST'){
      const form=new URLSearchParams(await readText(req));oauth.revoke(form.get('token')??'');res.statusCode=200;res.setHeader('cache-control','no-store');res.end();return true;
    }
    return path.startsWith('/oauth/')||path.startsWith('/.well-known/oauth-')?(res.statusCode=404,res.setHeader('cache-control','no-store'),res.end('Not Found'),true):false;
  }

  private authorizationPage(requestId:string,pairingCode:string){
    const id=h(requestId),code=h(pairingCode);
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Aevra</title><style>body{font-family:Inter,system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#fff;margin:0;min-height:100vh;display:grid;place-items:center}.panel{width:min(520px,calc(100% - 32px));border:1px solid #212327;border-radius:8px;background:#191919;padding:24px}h1{font-size:22px;font-weight:400;margin:0 0 8px}p{color:#dadbdf;line-height:1.5}.code{font:400 24px ui-monospace,monospace;letter-spacing:.12em;color:#fff;margin:18px 0}.status{font-size:13px;color:#dadbdf}</style></head><body><main class="panel" data-request-id="${id}"><h1>Authorize Aevra</h1><p>Approve this connection in the local Aevra UI. Confirm the pairing code before allowing access.</p><div class="code">${code}</div><p class="status" id="status">Waiting for local approval...</p></main><script>const id=${JSON.stringify(requestId)};const status=document.querySelector('#status');async function poll(){try{const r=await fetch('/oauth/authorize/status?request_id='+encodeURIComponent(id),{cache:'no-store'});const v=await r.json();if(v.status==='APPROVED'){location.replace('/oauth/authorize/continue?request_id='+encodeURIComponent(id));return}if(v.status==='DENIED'||v.status==='EXPIRED'){status.textContent=v.status==='DENIED'?'Connection denied locally.':'Connection request expired.';return}}catch{}setTimeout(poll,1200)}poll()</script></body></html>`;
  }

  private sameIdentity(sessionId:string,identity:VerifiedRemoteIdentity){const s=this.runtime?.sessions.get(sessionId);return Boolean(s&&s.actor===identity.actor&&s.subject===identity.subject);}
}
