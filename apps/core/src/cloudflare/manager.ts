import {isIP} from 'node:net';
import type {ChildProcess} from 'node:child_process';
import type {CloudflareAuthMode,CloudflareSetupInput,CloudflareSetupResult,CloudflaredStatus,ReachabilityResult} from '../../../../packages/protocol/src/index.js';
import type {SettingsRepository} from '../../../../packages/store/src/settings.js';
import {CloudflaredCli} from './cloudflared.js';

export type TunnelOwnership='managed'|'external';
export interface CloudflareManager{detectCloudflared():Promise<CloudflaredStatus>;authenticationStatus():Promise<{authenticated:boolean;message:string}>;authenticate():Promise<{code:number;stdout:string;stderr:string}>;setup(input:CloudflareSetupInput):Promise<CloudflareSetupResult>;startManagedTunnel():Promise<void>;stopManagedTunnel():Promise<void>;checkReachability():Promise<ReachabilityResult>;ownership():TunnelOwnership;}

export function resolveCloudflareAuthMode(config:any):CloudflareAuthMode{
  return config?.authMode==='access'||config?.authMode==='connector'?config.authMode:(config?.issuer&&config?.audience?'access':'connector');
}

export function normalizePublicHostname(value:string):string{
  const raw=String(value??'').trim();
  if(!raw)throw new Error('Public hostname is required');
  let hostname=raw;
  if(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)){
    let url:URL;try{url=new URL(raw)}catch{throw new Error('Public hostname URL is invalid')}
    if(url.protocol!=='https:')throw new Error('Public hostname URL must use https');
    if(url.username||url.password)throw new Error('Public hostname must not contain credentials');
    if(url.port)throw new Error('Public hostname must not contain a port');
    if((url.pathname&&url.pathname!=='/')||url.search||url.hash)throw new Error('Public hostname URL must not contain a path, query, or fragment');
    hostname=url.hostname;
  }else if(/[\/:?#@]/.test(raw))throw new Error('Public hostname must be a hostname or hostname-only https URL');
  hostname=hostname.toLowerCase().replace(/\.$/,'');
  if(hostname==='localhost'||isIP(hostname))throw new Error('Public hostname must be a public DNS hostname');
  if(hostname.length>253||!hostname.includes('.'))throw new Error('Public hostname must be a valid public DNS hostname');
  const labels=hostname.split('.');
  if(labels.some(label=>!label||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)))throw new Error('Public hostname must be a valid public DNS hostname');
  return hostname;
}

export class CloudflareManagerImpl implements CloudflareManager{
  private child?:ChildProcess;private stopping=false;private restartAttempt=0;private restartTimer?:NodeJS.Timeout;private stableTimer?:NodeJS.Timeout;
  constructor(private settings:SettingsRepository,private cli=new CloudflaredCli(),private origin='https://localhost:47832'){}
  async detectCloudflared(){return this.cli.version()}
  async authenticationStatus(){
    const detected=await this.detectCloudflared();
    if(!detected.found)return{authenticated:false,message:'cloudflared is not installed'};
    try{const result=await this.cli.listTunnels();return result.code===0?{authenticated:true,message:'Existing Cloudflare login is valid'}:{authenticated:false,message:(result.stderr||result.stdout||'Cloudflare login is not available').trim()};}catch(error){return{authenticated:false,message:error instanceof Error?error.message:String(error)}}
  }
  async authenticate(){
    const status=await this.authenticationStatus();
    if(status.authenticated)return{code:0,stdout:'Already authenticated with Cloudflare; existing credentials were kept.',stderr:''};
    return this.cli.login();
  }
  async setup(input:CloudflareSetupInput):Promise<CloudflareSetupResult>{
    const status=await this.detectCloudflared();if(!status.found)throw new Error('cloudflared not found');
    const hostname=normalizePublicHostname(input.hostname??'');
    const existing=this.settings.get<any>('cloudflare.config',null);
    if(input.authMode!==undefined&&input.authMode!=='connector'&&input.authMode!=='access')throw new Error('Remote authentication mode must be connector or access');
    if(input.ownership!==undefined&&input.ownership!=='managed'&&input.ownership!=='external')throw new Error('Tunnel ownership must be managed or external');
    const authMode:CloudflareAuthMode=input.authMode??resolveCloudflareAuthMode(input.issuer||input.audience?input:existing);
    const ownership:TunnelOwnership=input.ownership??this.ownership();
    const issuer=(input.issuer??existing?.issuer??this.settings.get<string>('cloudflare.issuer','')).trim();
    const audience=(input.audience??existing?.audience??this.settings.get<string>('cloudflare.audience','')).trim();
    if(authMode==='access'&&(!issuer||!audience))throw new Error('Cloudflare Access issuer and audience are required in Access mode');
    let tunnelId=input.tunnelId?.trim();
    if(!tunnelId){const created=await this.cli.createTunnel('aevra');if(created.code!==0)throw new Error(`cloudflared tunnel create failed: ${created.stderr}`);tunnelId=created.stdout.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];if(!tunnelId)throw new Error('Could not parse tunnel ID');}
    const routed=await this.cli.routeDns(tunnelId,hostname);if(routed.code!==0&&!/already exists/i.test(routed.stderr))throw new Error(`DNS route failed: ${routed.stderr}`);
    const result:CloudflareSetupResult={authMode,hostname,tunnelId,ownership,...(authMode==='access'?{issuer,audience}:{})};
    this.settings.set('cloudflare.config',result);this.settings.set('cloudflare.ownership',ownership);
    this.settings.set('cloudflare.issuer',authMode==='access'?issuer:'');this.settings.set('cloudflare.audience',authMode==='access'?audience:'');
    return result;
  }
  ownership(){return this.settings.get<TunnelOwnership>('cloudflare.ownership','managed')}
  async startManagedTunnel(){if(this.ownership()==='external')return;if(this.child&&!this.child.killed)return;const c=this.settings.get<any>('cloudflare.config',null);if(!c?.tunnelId)throw new Error('Cloudflare tunnel is not configured');this.stopping=false;this.child=this.cli.spawnTunnel(c.tunnelId,this.origin);clearTimeout(this.stableTimer);this.stableTimer=setTimeout(()=>{this.restartAttempt=0},60_000);this.child.once('exit',()=>{this.child=undefined;clearTimeout(this.stableTimer);if(!this.stopping&&this.ownership()==='managed'){const delay=Math.min(60_000,1000*2**Math.min(this.restartAttempt++,6));this.restartTimer=setTimeout(()=>void this.startManagedTunnel().catch(()=>{}),delay)}});}
  async stopManagedTunnel(){if(this.ownership()==='external')return;this.stopping=true;clearTimeout(this.restartTimer);clearTimeout(this.stableTimer);this.restartAttempt=0;if(this.child&&!this.child.killed)this.child.kill('SIGTERM');this.child=undefined;}
  async checkReachability():Promise<ReachabilityResult>{
    const c=this.settings.get<any>('cloudflare.config',null);if(!c?.hostname)return{reachable:false,message:'Cloudflare hostname is not configured'};
    const base=`https://${c.hostname}`;
    try{
      const health=await fetch(`${base}/health`,{signal:AbortSignal.timeout(5000),headers:{accept:'application/json'},cache:'no-store'});
      if(!health.ok)return{reachable:false,status:health.status,message:`Health check failed: HTTP ${health.status}`};
      const metadata=await fetch(`${base}/.well-known/oauth-protected-resource/mcp`,{signal:AbortSignal.timeout(5000),headers:{accept:'application/json'},cache:'no-store'});
      if(!metadata.ok)return{reachable:false,status:metadata.status,message:`OAuth discovery failed: HTTP ${metadata.status}`};
      let value:any;try{value=await metadata.json()}catch{return{reachable:false,status:metadata.status,message:'OAuth discovery failed: invalid JSON'}}
      const expected=`${base}/mcp`;
      if(value?.resource!==expected)return{reachable:false,status:metadata.status,message:`OAuth discovery resource mismatch: expected ${expected}`};
      if(!Array.isArray(value?.authorization_servers)||!value.authorization_servers.includes(base))return{reachable:false,status:metadata.status,message:`OAuth discovery authorization server mismatch: expected ${base}`};
      return{reachable:true,status:metadata.status,message:'reachable; OAuth discovery ready'};
    }catch(e){return{reachable:false,message:e instanceof Error?e.message:String(e)}}
  }
}
