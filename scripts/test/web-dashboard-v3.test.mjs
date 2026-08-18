import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const js=readFileSync('apps/web/app-v3.js','utf8');
const css=readFileSync('apps/web/app-v3.css','utf8');
const html=readFileSync('apps/web/index.html','utf8');

test('v3 assets are loaded after v2',()=>{assert.match(html,/app-v3\.css/);assert.match(html,/app-v3\.js/);});
test('dashboard runtime refresh is scoped to active Dashboard and uses one snapshot endpoint',()=>{assert.match(js,/\/api\/dashboard\/runtime/);assert.match(js,/2000/);assert.match(js,/dataset\.uiV2===['"]dashboard['"]/);});
test('dashboard keeps Remote Access independent and every section defaults expanded',()=>{assert.match(js,/makeDashboardCollapsible/);assert.match(js,/dashboard-section/);assert.match(js,/details\.open=true/);assert.match(js,/onboarding\.open=true/);assert.doesNotMatch(js,/remote-in-onboarding/);assert.doesNotMatch(js,/body\.prepend\(remote\)/);assert.doesNotMatch(js,/onboarding\.open=false/);});
test('active connections table and provider guide actions are present',()=>{assert.match(js,/Active connections/);for(const slug of ['connect-chatgpt','connect-claude','connect-gemini'])assert.match(js,new RegExp(slug));});
test('request details consume sanitized server presentation and expose scoped command approvals',()=>{assert.match(js,/item\.presentation/);assert.match(js,/Enable browser notifications/);assert.match(js,/requestPermission/);assert.match(js,/Saved matcher/);for(const text of ['Allow this session','Always in workspace','Always globally'])assert.match(js,new RegExp(text));assert.match(js,/item\.risk===['"]CRITICAL['"]/);assert.match(css,/request-detail/);});
test('request drawer decorates newly rendered critical cards immediately',()=>{assert.match(js,/latestApprovals/);assert.match(js,/decorateRequestDrawer\(latestApprovals\)/);});
test('request drawer no longer contains the obsolete workspace capability-upgrade branch',()=>{assert.doesNotMatch(js,/workspace:capability-upgrade/);assert.doesNotMatch(js,/v3Upgrade/);});
