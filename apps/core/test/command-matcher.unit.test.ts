import assert from 'node:assert/strict';import test from 'node:test';import {commandPermissionMatcher} from '../src/policy/command-matcher.js';

test('command matcher wildcards paths filenames and parameter values',()=>{
  assert.equal(commandPermissionMatcher(['git','diff','src/app.ts']),'git:diff:*');
  assert.equal(commandPermissionMatcher(['dotnet','test','tests/Aevra.Tests.csproj','--filter','Category=Fast']),'dotnet:test:*:--filter:*');
  assert.equal(commandPermissionMatcher(['npm','test','--','--runInBand']),'npm:test:--:*');
  assert.equal(commandPermissionMatcher(['cargo','test','worker_manager']),'cargo:test:*');
});

test('command matcher keeps option names and never stores shell script text',()=>{
  assert.equal(commandPermissionMatcher(['git','status','--short']),'git:status:--short');
  assert.equal(commandPermissionMatcher(['powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-Command','Get-Content secret.txt'],{shell:'powershell'}),'shell:powershell:*');
  assert.equal(commandPermissionMatcher(['bash','-lc','cat ./secret.txt'],{shell:'bash'}),'shell:bash:*');
});
