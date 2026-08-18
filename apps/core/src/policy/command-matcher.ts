const SUBCOMMAND_EXECUTABLES=new Set(['git','npm','pnpm','yarn','cargo','dotnet','go','rustup','npx']);
const SHELLS=new Set(['bash','sh','powershell','powershell.exe','pwsh','pwsh.exe']);
function executableName(value:string){return String(value||'unknown').split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/,'');}
function push(parts:string[],value:string){if(value==='*'&&parts.at(-1)==='*')return;parts.push(value);}
function executionSuffix(options:{executionMode?:'sandbox'|'host'}){return options.executionMode==='host'?':host-fallback':'';}
export function commandPermissionMatcher(command:string[]|{executable:string;args:string[]},options:{shell?:string;executionMode?:'sandbox'|'host'}={}):string{
  const argv=Array.isArray(command)?command:[command.executable,...(command.args??[])],rawExe=String(argv[0]??'unknown'),exe=executableName(rawExe),requestedShell=String(options.shell??'').toLowerCase(),suffix=executionSuffix(options);
  if(requestedShell||SHELLS.has(rawExe.toLowerCase())||SHELLS.has(exe)){const shell=requestedShell||(/power|pwsh/.test(exe)?'powershell':exe);return `shell:${shell}:*${suffix}`;}
  const args=argv.slice(1).map(value=>String(value)),parts=[exe];let index=0,afterSeparator=false;
  if(SUBCOMMAND_EXECUTABLES.has(exe)&&args[0]&&!args[0]!.startsWith('-')){parts.push(args[0]!.toLowerCase());index=1;}
  for(;index<args.length;index++){
    const token=args[index]!;
    if(afterSeparator){push(parts,'*');continue;}
    if(token==='--'){parts.push('--');afterSeparator=true;continue;}
    if(token.startsWith('-')){
      const eq=token.indexOf('=');
      if(eq>0){parts.push(token.slice(0,eq));push(parts,'*');}else parts.push(token);
      continue;
    }
    push(parts,'*');
  }
  return `${parts.join(':')}${suffix}`;
}
export function needsCommandPermissionApproval(outcome:'allow'|'deny'|'approval'|undefined,oneTimeAllowed:boolean){return !oneTimeAllowed&&outcome!=='allow';}
