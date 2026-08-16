import assert from 'node:assert/strict';import test from 'node:test';import {runCommand} from '../src/commands.js';
test('command execution uses argv without shell expansion',async()=>{const r=await runCommand({executable:process.execPath,args:['-e','console.log(process.argv[1])','a;echo-pwn'],env:{}});assert.equal(r.exitCode,0);assert.match(r.stdout,/a;echo-pwn/);});
