import {randomBytes,randomUUID} from 'node:crypto';
import {existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SocketWorkerClient,type WorkerClient} from '../../../../packages/ipc/src/client.js';
import {HmacEnvelopeSigner} from '../../../../packages/ipc/src/envelope.js';
import type {CapabilityRoot,ExecutionMode} from '../../../../packages/protocol/src/index.js';
import type {WorkerOperation,WorkerResult} from '../../../../packages/protocol/src/worker.js';

export interface AuthorizedWorkerInput{sessionId:string;workspaceId:string;roots:CapabilityRoot[];operation:WorkerOperation;expectedState?:Record<string,string>;executionMode?:ExecutionMode;}
export interface WorkerManagerOptions{entryPath?:string;startupTimeoutMs?:number;startupPollMs?:number;}

type ExitInfo={code:number|null;signal:NodeJS.Signals|null};
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const defaultWorkerEntry=()=>fileURLToPath(new URL('../../../worker/src/main.js',import.meta.url));
function boundedAppend(current:string,chunk:unknown,max=8192){const next=current+String(chunk);return next.length<=max?next:next.slice(next.length-max);}
function workerDiagnostics(stderr:string,stdout:string){const detail=stderr.trim()||stdout.trim();return detail?`: ${detail}`:'';}

export class WorkerManager{
  private child?:ChildProcess;private client?:SocketWorkerClient;private signer?:HmacEnvelopeSigner;
  readonly daemonInstanceId=randomUUID();
  constructor(private endpoint:string,private processLogDir=path.join(process.cwd(),'.aevra-process-logs'),private options:WorkerManagerOptions={}){}
  async start():Promise<WorkerClient>{
    if(this.client)return this.client;
    if(process.platform!=='win32'&&existsSync(this.endpoint))rmSync(this.endpoint,{force:true});
    const secret=randomBytes(32);this.signer=new HmacEnvelopeSigner(secret,this.daemonInstanceId);
    const entry=this.options.entryPath??defaultWorkerEntry();if(!existsSync(entry))throw new Error(`Execution Worker build is missing at ${entry}; run npm run build`);
    let stdout='',stderr='',exitInfo:ExitInfo|undefined,startError:Error|undefined;
    const child=this.child=spawn(process.execPath,[entry],{stdio:['ignore','pipe','pipe'],env:{...process.env,AEVRA_WORKER_ENDPOINT:this.endpoint,AEVRA_WORKER_SECRET:secret.toString('base64url'),AEVRA_DAEMON_INSTANCE_ID:this.daemonInstanceId,AEVRA_PROCESS_LOG_DIR:this.processLogDir}});
    child.stdout?.on('data',chunk=>{stdout=boundedAppend(stdout,chunk)});
    child.stderr?.on('data',chunk=>{stderr=boundedAppend(stderr,chunk)});
    child.once('error',error=>{startError=error});
    child.once('exit',(code,signal)=>{exitInfo={code,signal}});
    const timeout=this.options.startupTimeoutMs??5000,poll=this.options.startupPollMs??50,deadline=Date.now()+timeout;
    let lastError:unknown;
    while(Date.now()<deadline){
      if(startError){await this.cleanupFailedStart();throw new Error(`Execution Worker failed to spawn: ${startError.message}${workerDiagnostics(stderr,stdout)}`);}
      if(exitInfo){const info=exitInfo;await this.cleanupFailedStart();throw new Error(`Execution Worker exited ${info.code??'null'}${info.signal?` (${info.signal})`:''}${workerDiagnostics(stderr,stdout)}`);}
      const candidate=new SocketWorkerClient(this.endpoint,secret,this.daemonInstanceId);
      try{await candidate.health();this.client=candidate;return candidate}catch(error){lastError=error;await candidate.close();}
      await delay(poll);
    }
    if(exitInfo){const info=exitInfo;await this.cleanupFailedStart();throw new Error(`Execution Worker exited ${info.code??'null'}${info.signal?` (${info.signal})`:''}${workerDiagnostics(stderr,stdout)}`);}
    await this.cleanupFailedStart();
    const reason=lastError instanceof Error?lastError.message:String(lastError??'startup timeout');
    throw new Error(`Execution Worker did not become ready: ${reason}${workerDiagnostics(stderr,stdout)}`);
  }
  async execute(input:AuthorizedWorkerInput):Promise<WorkerResult>{
    if(!this.client||!this.signer)throw Object.assign(new Error('Execution Worker unavailable'),{code:'EXECUTOR_UNAVAILABLE'});
    const now=Date.now();const envelope=this.signer.sign({version:1,daemonInstanceId:this.daemonInstanceId,operationId:`op_${randomUUID()}`,sessionId:input.sessionId,workspaceId:input.workspaceId,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+30_000).toISOString(),nonce:randomUUID(),executionMode:input.executionMode??'host',capabilityRoots:input.roots,operation:input.operation,...(input.expectedState?{expectedState:input.expectedState}:{})});
    return this.client.execute(envelope);
  }
  private async stopChild(){
    const child=this.child;this.child=undefined;if(!child||child.exitCode!==null)return;
    const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
    child.kill('SIGTERM');await Promise.race([exited,delay(500)]);
    if(child.exitCode===null){child.kill('SIGKILL');await Promise.race([exited,delay(500)]);}
  }
  private async cleanupFailedStart(){await this.client?.close();this.client=undefined;this.signer=undefined;await this.stopChild();if(process.platform!=='win32')rmSync(this.endpoint,{force:true});}
  async close(){await this.client?.close();this.client=undefined;this.signer=undefined;await this.stopChild();if(process.platform!=='win32')rmSync(this.endpoint,{force:true});}
}
