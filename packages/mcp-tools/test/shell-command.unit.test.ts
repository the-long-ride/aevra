import assert from 'node:assert/strict';
import test from 'node:test';
import {buildShellCommand,shellRiskFloor} from '../src/shell-command.js';

test('sandbox auto shell uses bash without shell interpolation in Node',()=>{
  const command=buildShellCommand({script:'printf "%s\\n" "$PWD"',shell:'auto',executionMode:'sandbox',timeoutMs:12_000,env:{A:'B'}},'win32');
  assert.equal(command.executable,'bash');
  assert.deepEqual(command.args,['-lc','printf "%s\\n" "$PWD"']);
  assert.equal(command.timeoutMs,12_000);
  assert.deepEqual(command.env,{A:'B'});
});

test('host auto shell resolves to native PowerShell on Windows',()=>{
  const command=buildShellCommand({script:'Get-ChildItem',shell:'auto',executionMode:'host'},'win32');
  assert.equal(command.executable,'powershell.exe');
  assert.deepEqual(command.args,['-NoLogo','-NoProfile','-NonInteractive','-Command','Get-ChildItem']);
});

test('host auto shell resolves to bash on unix-like systems',()=>{
  const command=buildShellCommand({script:'pwd',shell:'auto',executionMode:'host'},'linux');
  assert.equal(command.executable,'bash');
  assert.deepEqual(command.args,['-lc','pwd']);
});

test('PowerShell is rejected in the current Linux strict sandbox image',()=>{
  assert.throws(
    ()=>buildShellCommand({script:'Get-ChildItem',shell:'powershell',executionMode:'sandbox'},'win32'),
    (error:any)=>error?.code==='INVALID_REQUEST'&&/host execution/.test(error.message),
  );
});

test('shell execution has a stronger approval floor than argv commands',()=>{
  assert.equal(shellRiskFloor('sandbox'),'MEDIUM');
  assert.equal(shellRiskFloor('host'),'HIGH');
});
