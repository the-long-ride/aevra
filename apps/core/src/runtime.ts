import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import type {CoreConfig} from './config.js';
import {AevraDatabase} from '../../../packages/store/src/database.js';
import {WorkspaceRepository} from '../../../packages/store/src/workspaces.js';
import {SessionRepository} from '../../../packages/store/src/sessions.js';
import {PermissionRepository} from '../../../packages/store/src/permissions.js';
import {ApprovalRepository} from '../../../packages/store/src/approvals.js';
import {OperationRepository} from '../../../packages/store/src/operations.js';
import {ChangeRepository} from '../../../packages/store/src/changes.js';
import {AuditRepository} from '../../../packages/store/src/audit.js';
import {ProcessRepository} from '../../../packages/store/src/processes.js';
import {ConnectorRepository} from '../../../packages/store/src/connectors.js';
import {OAuthRepository} from '../../../packages/store/src/oauth.js';
import {SkillsService} from './skills/skills-service.js';
import {IpRateLimiter} from './mcp/rate-limit.js';
import {AEVRA_VERSION} from './version.js';
import {MetricsService} from './metrics.js';
import {TunnelWatchdog} from './cloudflare/watchdog.js';
import {SettingsRepository} from '../../../packages/store/src/settings.js';
import {WorkerManager} from './worker/worker-manager.js';
import {AdminServer} from './admin/server.js';
import {McpIngressServer} from './mcp/server.js';
import {AdminBootstrapService,ensureLocalControlSecret} from './admin/bootstrap.js';
import type {WorkerClient} from '../../../packages/ipc/src/client.js';
import {CapabilityProfileService} from './policy/capabilities.js';
import {SessionManager} from './sessions/session-manager.js';
import {WorkspaceService} from './workspaces/workspace-service.js';
import {ReadVersionCache} from './operations/read-version-cache.js';
import {AuditService} from './audit/audit-service.js';
import {ApprovalService} from './approvals/approval-service.js';
import {PermissionEngine} from './policy/permissions.js';
import {OperationService} from './operations/operation-service.js';
import {ChangeSetService} from './changes/change-service.js';
import {ProcessService} from './processes/process-service.js';
import {McpToolService,type WorkerGateway} from '../../../packages/mcp-tools/src/service.js';
import {CloudflareAccessVerifier,RejectingIdentityVerifier} from './auth/cloudflare.js';
import {AevraOAuthService} from './auth/oauth.js';
import {CloudflareManagerImpl,resolveCloudflareAuthMode,type CloudflareManager} from './cloudflare/manager.js';
import {BackupService} from './backup/backup-service.js';
import {ConfigExportService} from './config/export-service.js';
import {EncryptedVault} from '../../../packages/secrets/src/vault.js';import {CommandSecretStore} from '../../../packages/secrets/src/platform.js';
import {EnvironmentService} from './secrets/environment-service.js';
import {ensureLocalTls,type LocalTlsMaterial} from './tls/local-tls.js';

export interface CoreRuntime{readonly adminUrl:string;readonly mcpUrl:string;start():Promise<void>;close():Promise<void>;}
export interface RuntimeDependencies{worker?:{start():Promise<WorkerClient>;close():Promise<void>;execute?:(input:any)=>Promise<any>};databaseOpen?:(path:string)=>AevraDatabase;tls?:LocalTlsMaterial;ensureTls?:(config:CoreConfig)=>Promise<LocalTlsMaterial>;cloudflare?:CloudflareManager;}

export async function createCoreRuntime(config:CoreConfig,deps:RuntimeDependencies={}):Promise<CoreRuntime>{
  let db:AevraDatabase|undefined,worker:WorkerClient|undefined,admin:AdminServer|undefined,mcp:McpIngressServer|undefined,cloudflare:CloudflareManager|undefined;let safeMode=false,started=false;let watchdog:TunnelWatchdog|undefined;
  const wm:any=deps.worker??new WorkerManager(config.workerSocketPath,path.join(config.stateDir,'process-logs'));
  const cleanup=async()=>{
    watchdog?.stop();watchdog=undefined;
    const safe=async(fn:()=>Promise<unknown>)=>{try{await fn()}catch{/* Preserve the original startup/shutdown error. */}};
    if(cloudflare)await safe(()=>cloudflare!.stopManagedTunnel());
    if(mcp)await safe(()=>mcp!.close());mcp=undefined;
    if(admin)await safe(()=>admin!.close());admin=undefined;
    if(worker)await safe(()=>wm.close());worker=undefined;
    try{db?.close()}catch{/* best-effort close */}db=undefined;started=false;
  };
  return{
    get adminUrl(){return admin?admin.url():`https://localhost:${config.adminPort}`},
    get mcpUrl(){return mcp?mcp.url():`https://localhost:${config.mcpPort}`},
    async start(){
      if(started)return;
      try{
      await mkdir(config.stateDir,{recursive:true,mode:0o700});await mkdir(config.recoveryDir,{recursive:true,mode:0o700});
      const tls=deps.tls??await (deps.ensureTls??(async(c:CoreConfig)=>ensureLocalTls(c.stateDir,{certificatePath:c.tlsCertPath,keyPath:c.tlsKeyPath,caPath:c.tlsCaPath})))(config);
      db=(deps.databaseOpen??AevraDatabase.open)(config.databasePath);safeMode=!db.integrityCheck().ok;
      const raw=db.raw(),settings=new SettingsRepository(raw),workspaceRepo=new WorkspaceRepository(raw),sessionRepo=new SessionRepository(raw),permissionRepo=new PermissionRepository(raw),approvalRepo=new ApprovalRepository(raw),operationRepo=new OperationRepository(raw),changeRepo=new ChangeRepository(raw),auditRepo=new AuditRepository(raw),processRepo=new ProcessRepository(raw),connectorRepo=new ConnectorRepository(raw),oauthRepo=new OAuthRepository(raw);
      const connectorBindings=(subject:string)=>connectorRepo.getBindings(subject);
      processRepo.markKeepRunningUncertain();
      const workspaces=new WorkspaceService(workspaceRepo),profiles=new CapabilityProfileService(raw),sessions=new SessionManager(sessionRepo,profiles,config.leaseIdleMs),audit=new AuditService(auditRepo),permissions=new PermissionEngine(permissionRepo),reads=new ReadVersionCache();
      sessions.invalidateForRestart();oauthRepo.invalidateEphemeralForRestart();
      if(!safeMode)worker=await wm.start();
      const workerGateway:WorkerGateway=!safeMode&&typeof wm.execute==='function'?wm:{async execute(){return{ok:false,error:{code:'EXECUTOR_UNAVAILABLE',message:'Execution Worker unavailable'}} as any}};
      const changes=new ChangeSetService(changeRepo,operationRepo,workspaces,workerGateway,config.recoveryDir),operations=new OperationService(sessions,workspaces,workerGateway,operationRepo,audit,reads),processes=new ProcessService(sessions,workspaces,workerGateway,processRepo);
      operations.attachChangeService(changes);operations.setCommandEffectResolver((family,defaultEffect)=>{const overrides=settings.get<Record<string,string>>('command.family.overrides',{});const value=overrides[family];return ['READ_ONLY','BUILD_OUTPUT','SOURCE_MUTATION','REPOSITORY_STATE','UNKNOWN'].includes(value)?value as any:defaultEffect});operations.setExecutionSettingsResolver(()=>settings.get('execution.settings',{sandboxBackend:'auto',cachePolicy:'workspace'}));sessions.setSwitchDrainHandler((sessionId,_old,_next,timeoutMs)=>operations.drainSession(sessionId,timeoutMs??settings.get<number>('workspace.drain.defaultMs',60_000)));if(!safeMode)await changes.reconcileIncompleteOperations();
      const approvals=new ApprovalService(approvalRepo,audit,{fastWaitMs:config.approvalFastWaitMs,lifetimeMs:config.approvalLifetimeMs,lifetimeByRiskMs:config.approvalLifetimeByRiskMs});if(!safeMode)approvals.cancelForRestart();
      const metrics=new MetricsService();
      const tools=new McpToolService(sessions,workspaces,workerGateway,reads,approvals,{operations,processes,changes,permissions,approvals,skills:new SkillsService(),connectorBindings,metrics,settings});
      const bootstrap=new AdminBootstrapService(raw),controlSecret=ensureLocalControlSecret(config.stateDir);cloudflare=deps.cloudflare??new CloudflareManagerImpl(settings,undefined,`https://localhost:${config.mcpPort}`);const vault=new EncryptedVault(path.join(config.stateDir,'secrets.vault')),platformSecrets=new CommandSecretStore(process.platform),secretStore=await platformSecrets.probe()?platformSecrets:vault,environment=new EnvironmentService(raw,secretStore),configExport=new ConfigExportService(raw),backup=new BackupService(db,path.join(config.stateDir,'backups'));
      const staticDir=path.resolve('dist/apps/web');
      const databaseAdmin={configExport:(portable:boolean)=>configExport.export(portable),configPreview:(v:any)=>configExport.previewImport(v),backup:()=>backup.create('daily')};
      const cloudflareConfig=settings.get<any>('cloudflare.config',null);
      const oauthBase=cloudflareConfig?.hostname?`https://${cloudflareConfig.hostname}`:`https://localhost:${config.mcpPort}`;
      const oauth=new AevraOAuthService(oauthRepo,{issuer:oauthBase,resource:`${oauthBase}/mcp`});
      admin=new AdminServer(config.adminHost,config.adminPort,()=>({version:AEVRA_VERSION,core:'running',worker:worker?'running':'unavailable',mcp:mcp?'running':'starting',tunnel:settings.get('cloudflare.config',null)?'configured':'unconfigured',tunnelReachable:watchdog?.status.reachable??null,tunnelCheckedAt:watchdog?.status.checkedAt??null,safeMode,connectorFailedAttempts:connectorLimiter.totalFailures()}),{bootstrap,controlSecret,staticDir,tls:tls.serverOptions,advertisedHost:'localhost',api:{workspaces,approvals,permissions:permissionRepo,sessions,profiles,bootstrap,processes,changes,audit,settings,cloudflare,oauth,environment,vault,database:databaseAdmin,connectors:connectorRepo,metrics,safeMode:()=>safeMode}});
      const issuer=process.env.AEVRA_CF_ISSUER??cloudflareConfig?.issuer??settings.get<string>('cloudflare.issuer',''),audience=process.env.AEVRA_CF_AUDIENCE??cloudflareConfig?.audience??settings.get<string>('cloudflare.audience','');
      const authMode=(process.env.AEVRA_CF_ISSUER&&process.env.AEVRA_CF_AUDIENCE)?'access':resolveCloudflareAuthMode(cloudflareConfig??{issuer,audience});
      const accessReady=authMode==='access'&&Boolean(issuer&&audience);
      const verifier=accessReady?new CloudflareAccessVerifier(issuer,audience):new RejectingIdentityVerifier();
      const connectorLimiter=new IpRateLimiter(30,1);
      const connectorsAdmission={verify:async(token:string,ip:string)=>{if(!connectorLimiter.allow(ip))return{kind:'rate-limited'} as const;const row=connectorRepo.findByToken(token);if(!row){connectorLimiter.recordFailure(ip);return{kind:'denied'} as const;}connectorRepo.recordUse(row.id);return{kind:'admitted',identity:{actor:`connector:${row.name}`,subject:row.id,issuer:'aevra:connector',audience:'aevra',expiresAt:new Date(Date.now()+24*3_600_000).toISOString()}} as const;}};
      mcp=new McpIngressServer(config.mcpHost,config.mcpPort,verifier,undefined,()=>safeMode,{sessions,service:tools},connectorsAdmission,{tls:tls.serverOptions,advertisedHost:'localhost',plainMcpEnabled:accessReady,oauth});
      watchdog=(!safeMode&&settings.get('cloudflare.config',null))?new TunnelWatchdog(()=>cloudflare!.checkReachability(),60_000).start():undefined;
      await admin.start();await mcp.start();if(!cloudflareConfig?.hostname)oauth.setPublicBaseUrl(mcp.url());if(settings.get('cloudflare.config',null)&&cloudflare.ownership()==='managed')await cloudflare.startManagedTunnel();started=true;
      }catch(error){await cleanup();throw error;}
    },
    async close(){
      if(!started&&!db&&!worker&&!admin&&!mcp)return;
      await cleanup();
    }
  };
}
