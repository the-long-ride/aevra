import assert from 'node:assert/strict';import test from 'node:test';
async function matcher(){try{return(await import('../src/policy/command-matcher.js')).commandPermissionMatcher as ((command:string[],options?:{shell?:string})=>string);}catch{return undefined;}}

test('command matcher wildcards paths filenames and parameter values',async()=>{const commandPermissionMatcher=await matcher();assert.equal(typeof commandPermissionMatcher,'function','commandPermissionMatcher must exist');
  assert.equal(commandPermissionMatcher!(['git','diff','src/app.ts']),'git:diff:*');
  assert.equal(commandPermissionMatcher!(['dotnet','test','tests/Aevra.Tests.csproj','--filter','Category=Fast']),'dotnet:test:*:--filter:*');
  assert.equal(commandPermissionMatcher!(['npm','test','--','--runInBand']),'npm:test:--:*');
  assert.equal(commandPermissionMatcher!(['cargo','test','worker_manager']),'cargo:test:*');
});

test('command matcher keeps option names and never stores shell script text',async()=>{const commandPermissionMatcher=await matcher();assert.equal(typeof commandPermissionMatcher,'function','commandPermissionMatcher must exist');
  assert.equal(commandPermissionMatcher!(['git','status','--short']),'git:status:--short');
  assert.equal(commandPermissionMatcher!(['powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-Command','Get-Content secret.txt'],{shell:'powershell'}),'shell:powershell:*');
  assert.equal(commandPermissionMatcher!(['bash','-lc','cat ./secret.txt'],{shell:'bash'}),'shell:bash:*');
});
