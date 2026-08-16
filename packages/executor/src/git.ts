import {runCommand} from './commands.js';
async function git(cwd:string,args:string[]){return runCommand({executable:'git',args,cwdLogical:'/',env:{},timeoutMs:120_000},cwd)}
export const gitStatus=(cwd:string)=>git(cwd,['status','--porcelain=v1','--branch']);
export const gitDiff=(cwd:string,args:string[]=[])=>git(cwd,['diff',...args]);
export const gitLog=(cwd:string,args:string[]=[])=>git(cwd,['log','--oneline','-n','50',...args]);
export const gitBranch=(cwd:string,args:string[]=[])=>git(cwd,['branch',...args]);
export const gitCommit=(cwd:string,message:string,args:string[]=[])=>git(cwd,['commit','-m',message,...args]);
export const gitPush=(cwd:string,remote?:string,branch?:string,args:string[]=[])=>git(cwd,['push',...(remote?[remote]:[]),...(branch?[branch]:[]),...args]);
