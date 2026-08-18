import assert from 'node:assert/strict';
import test from 'node:test';
import {presentApproval} from '../src/approvals/request-presentation.js';

function ticket(overrides:any={}){return{id:'req_1',actor:'oauth:ChatGPT',sessionId:'ses_1',workspaceId:'ws_1',operation:{family:'command:run',capability:'commands.run',risk:'HIGH',argsHash:'x'},payload:{},expectedState:{},risk:'HIGH',state:'PENDING',expiresAt:new Date(Date.now()+60_000).toISOString(),...overrides};}

test('presents workspace and local-skill requests clearly',()=>{
  assert.deepEqual(presentApproval(ticket({operation:{family:'workspace:select',capability:'files.read',risk:'MEDIUM',argsHash:'x'},payload:{tool:'workspace_select',workspaceId:'ws_1'}})),{title:'Workspace access',action:'Read workspace',target:'ws_1'});
  const skills=presentApproval(ticket({operation:{family:'skills:read',capability:'files.read',risk:'MEDIUM',argsHash:'x'},payload:{tool:'skills_access'}}));
  assert.equal(skills.title,'Local skills access');
  assert.match(skills.action,/skills and instructions/i);
});

test('presents file, git, command and shell intent without environment values',()=>{
  const del=presentApproval(ticket({operation:{family:'files:delete',capability:'files.delete',risk:'HIGH',argsHash:'x'},payload:{tool:'file_delete',args:{path:'/src/a.ts',recursive:false}}}));
  assert.equal(del.action,'Delete file');assert.equal(del.target,'/src/a.ts');

  const push=presentApproval(ticket({operation:{family:'git:push',capability:'git.push',risk:'HIGH',argsHash:'x'},payload:{tool:'git_push',args:{remote:'origin',branch:'main'}}}));
  assert.equal(push.action,'Git push');assert.match(push.target,/origin\/main/);

  const secret='super-secret-value-123456789';
  const command=presentApproval(ticket({payload:{tool:'command_run',args:{command:{executable:'npm',args:['test'],env:{TOKEN:secret}},executionMode:'host'}}}));
  assert.equal(command.title,'Run command');assert.equal(command.target,'Host workspace');assert.match(command.preview??'',/npm test/);assert.equal(JSON.stringify(command).includes(secret),false);

  const shell=presentApproval(ticket({operation:{family:'shell:bash',capability:'commands.run',risk:'HIGH',argsHash:'x'},payload:{tool:'command_run',sourceTool:'shell_run',shell:'bash',script:`echo ${secret}`,args:{command:{executable:'bash',args:['-lc',`echo ${secret}`],env:{}},executionMode:'sandbox'}}}));
  assert.equal(shell.title,'Run shell script');assert.equal(shell.target,'Strict sandbox');assert.equal((shell.preview??'').includes(secret),false);
});

test('presents coding profile upgrade and added capabilities',()=>{
  const view=presentApproval(ticket({operation:{family:'workspace:capability-upgrade',capability:'files.write',risk:'MEDIUM',argsHash:'x'},payload:{tool:'workspace_capability_upgrade',profileId:'coding-session',workspaceId:'ws_1',requestedCapability:'files.write',addedCapabilities:['files.write','commands.run']}}));
  assert.equal(view.title,'Enable coding access');
  assert.equal(view.target,'ws_1');
  assert.match(view.preview??'',/files\.write/);
  assert.match(view.preview??'',/commands\.run/);
});
