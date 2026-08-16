import type { CoreConfig } from '../../core/src/config.js';
import type { CoreRuntime } from '../../core/src/runtime.js';
export interface AevraSignalSource { once(event:'SIGINT'|'SIGTERM',listener:()=>void):unknown; removeListener(event:'SIGINT'|'SIGTERM',listener:()=>void):unknown; }
export interface RunStartDependencies { signals:AevraSignalSource; createRuntime(config:CoreConfig):Promise<CoreRuntime>; onReady?(info:{adminUrl:string;mcpUrl:string}):void|Promise<void>; }
export async function runStart(config:CoreConfig,deps:RunStartDependencies):Promise<number>{
  const runtime=await deps.createRuntime(config); await runtime.start(); await deps.onReady?.({adminUrl:runtime.adminUrl,mcpUrl:runtime.mcpUrl});
  return await new Promise<number>((resolve)=>{ let closing=false; const shutdown=()=>{ if(closing)return; closing=true; void runtime.close().finally(()=>{deps.signals.removeListener('SIGINT',shutdown);deps.signals.removeListener('SIGTERM',shutdown);resolve(0);});}; deps.signals.once('SIGINT',shutdown); deps.signals.once('SIGTERM',shutdown); });
}
