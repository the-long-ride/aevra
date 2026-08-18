import http,{type IncomingMessage,type ServerResponse} from 'node:http';
import https,{type ServerOptions as HttpsServerOptions} from 'node:https';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import type {AdminBootstrapService} from './bootstrap.js';
import {secretEquals} from './bootstrap.js';
import {handleAdminApi,type AdminApiContext} from './routes/api.js';
import {buildDashboardRuntimeSnapshot} from './dashboard-runtime.js';

function json(res:ServerResponse,status:number,value:unknown){res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(value));}
function cookie(req:IncomingMessage,name:string){const raw=req.headers.cookie??'';for(const part of raw.split(';')){const [k,...v]=part.trim().split('=');if(k===name)return decodeURIComponent(v.join('='));}return undefined;}
function isMutation(req:IncomingMessage){return !['GET','HEAD','OPTIONS'].includes(req.method??'GET');}
function sameOrigin(req:IncomingMessage,url:URL){
  if(!isMutation(req))return true;
  const fetchSite=req.headers['sec-fetch-site'];
  if(typeof fetchSite==='string'&&!['same-origin','none'].includes(fetchSite))return false;
  const origin=req.headers.origin;
  if(typeof origin==='string'&&origin!==url.origin)return false;
  return true;
}
export interface AdminServerOptions{bootstrap?:AdminBootstrapService;controlSecret?:string;staticDir?:string;api?:AdminApiContext;tls?:HttpsServerOptions;advertisedHost?:string;}
export class AdminServer{
  private server?:http.Server|https.Server;
  private readonly startedAt=new Date().toISOString();
  constructor(private host:string,private port:number,private health:()=>unknown,private options:AdminServerOptions={}){}
  async start(){this.server=this.options.tls?https.createServer(this.options.tls,(req,res)=>void this.handle(req,res)):http.createServer((req,res)=>void this.handle(req,res));await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(this.port,this.host,resolve)});const a=this.server.address();if(a&&typeof a!=='string')this.port=a.port;}
  address(){return this.server?.address()}
  url(){return `${this.options.tls?'https':'http'}://${this.options.advertisedHost??this.host}:${this.port}`}
  async close(){if(!this.server)return;await new Promise<void>(r=>this.server!.close(()=>r()));this.server=undefined;}
  private isAdmin(req:IncomingMessage){return this.options.bootstrap?.validateSession(cookie(req,'aevra_admin'))??false;}
  private async handle(req:IncomingMessage,res:ServerResponse){
    const u=new URL(req.url??'/',this.url());
    if(u.pathname==='/api/health'){json(res,200,this.health());return;}
    if(u.pathname==='/api/local/bootstrap'&&req.method==='POST'){if(!secretEquals(req.headers['x-aevra-control'] as string|undefined,this.options.controlSecret??'')){json(res,401,{error:'unauthorized'});return;}json(res,200,await this.options.bootstrap!.issue());return;}
    if(u.pathname==='/api/local/logout-all'&&req.method==='POST'){if(!secretEquals(req.headers['x-aevra-control'] as string|undefined,this.options.controlSecret??'')){json(res,401,{error:'unauthorized'});return;}await this.options.bootstrap!.revokeAll();json(res,200,{ok:true});return;}
    if(u.pathname==='/auth/bootstrap'&&req.method==='GET'){const session=await this.options.bootstrap?.consume(u.searchParams.get('token')??'');if(!session){json(res,401,{error:'invalid bootstrap token'});return;}res.statusCode=302;res.setHeader('set-cookie',`aevra_admin=${encodeURIComponent(session.sessionId)}; ${this.options.tls?'Secure; ':''}HttpOnly; SameSite=Strict; Path=/`);res.setHeader('location','/');res.end();return;}
    if(u.pathname.startsWith('/api/')&&!this.isAdmin(req)){json(res,401,{error:'admin session required'});return;}
    if(u.pathname.startsWith('/api/')&&!sameOrigin(req,u)){json(res,403,{error:{code:'CSRF_REJECTED',message:'State-changing admin requests must be same-origin'}});return;}
    if(u.pathname==='/api/status'){json(res,200,{...(this.health() as any),startedAt:this.startedAt});return;}
    if(u.pathname==='/api/dashboard/runtime'){json(res,200,buildDashboardRuntimeSnapshot(this.options.api??{},this.health(),this.startedAt));return;}
    if(u.pathname.startsWith('/api/')&&this.options.api&&await handleAdminApi(req,res,u,this.options.api))return;
    const dir=this.options.staticDir;
    if(dir){const relative=u.pathname==='/'?'index.html':u.pathname.replace(/^\//,'');const root=path.resolve(dir),file=path.resolve(root,relative);if((file===root||file.startsWith(root+path.sep))&&existsSync(file)){res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(file));return;}}
    res.statusCode=404;res.end('Not Found');
  }
}
