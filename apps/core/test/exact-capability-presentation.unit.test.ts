import assert from 'node:assert/strict';
import test from 'node:test';
import {presentApproval} from '../src/approvals/request-presentation.js';

function ticket(actor:string,capability:string,matcher='*'){return{id:'req',actor,sessionId:'ses',workspaceId:'ws',operation:{family:matcher==='*'?`capability:${capability}`:matcher,capability,risk:'MEDIUM',argsHash:'h'},payload:{tool:'capability_request',requestedCapability:capability,permissionMatcher:matcher,original:{tool:'file_write',args:{path:'/src/app.ts'}}},expectedState:{},risk:'MEDIUM',state:'PENDING',expiresAt:new Date(Date.now()+60_000).toISOString()} as any;}

test('exact capability presentation names the connector and capability',()=>{const view=presentApproval(ticket('oauth:ChatGPT','files.write'));assert.equal(view.title,'ChatGPT requests files.write');assert.equal(view.action,'Grant files.write');assert.equal(view.target,'Workspace ws');assert.match(view.preview??'',/write \/src\/app\.ts/);});

test('command capability presentation includes matcher',()=>{const view=presentApproval(ticket('connector:Claude','commands.run','git:status'));assert.equal(view.title,'Claude requests commands.run');assert.match(view.preview??'',/Matcher: git:status/);});
