import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const js=readFileSync('apps/web/app-v3.js','utf8');
const css=readFileSync('apps/web/app-v3.css','utf8');
const html=readFileSync('apps/web/index.html','utf8');

test('v3 assets are loaded after v2',()=>{assert.match(html,/app-v3\.css/);assert.match(html,/app-v3\.js/);});
test('dashboard runtime refresh is scoped to active Dashboard and uses one snapshot endpoint',()=>{assert.match(js,/\/api\/dashboard\/runtime/);assert.match(js,/2000/);assert.match(js,/dataset\.uiV2===['"]dashboard['"]/);});
test('completed onboarding moves to bottom and absorbs Remote Access',()=>{assert.match(js,/remote-in-onboarding/);assert.match(js,/append\(onboarding\)/);assert.match(js,/onboarding\.open=false/);});
test('active connections table and provider guide actions are present',()=>{assert.match(js,/Active connections/);for(const slug of ['connect-chatgpt','connect-claude','connect-gemini'])assert.match(js,new RegExp(slug));});
test('request details consume sanitized server presentation and expose explicit browser notification opt-in',()=>{assert.match(js,/item\.presentation/);assert.match(js,/Enable browser notifications/);assert.match(js,/requestPermission/);assert.match(css,/request-detail/);});
