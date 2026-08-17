import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';

test('local admin shell exposes control-plane pages without legacy browser relay',()=>{const app=readFileSync('apps/web/app.js','utf8');for(const page of ['workspaces','approvals','permissions','sessions','connectors','processes','changes','audit','settings'])assert.match(app,new RegExp(page));assert.doesNotMatch(app,/browser relay|extension control websocket/i);assert.match(app,/SAFE MODE/);});
test('web admin shell JavaScript parses before it is shipped',()=>{for(const file of ['apps/web/app.js','apps/web/ui-runtime.js']){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);}});
test('build validates browser JavaScript before copying static assets',()=>{const pkg=JSON.parse(readFileSync('package.json','utf8'));assert.match(pkg.scripts.build,/node --check apps\/web\/app\.js/);});

test('xAI design authority keeps the dense admin shell compact without a boxed navigation rail',()=>{
  const css=readFileSync('apps/web/app.css','utf8');
  assert.match(css,/--canvas:\s*#0a0a0a/i);
  assert.match(css,/--surface:\s*#191919/i);
  assert.match(css,/--border:\s*#212327/i);
  assert.match(css,/--accent:\s*#ffffff/i);
  assert.doesNotMatch(css,/#73f2a7|--m-blue|--m-red/i);
  assert.match(css,/border-radius:\s*9999px/);
  assert.match(css,/nav\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/s);
  assert.doesNotMatch(css,/nav button\.active\s*\{[^}]*box-shadow:\s*inset/s);
  assert.match(css,/\.card-grid/);
  assert.match(css,/\.card\s*\{[^}]*border-radius:\s*8px/s);
  assert.doesNotMatch(css,/\.card\s*\{[^}]*box-shadow:/s);
});

test('UI runtime loads before the app and provides mutation toasts plus live request notifications',()=>{
  const html=readFileSync('apps/web/index.html','utf8');
  const runtimeIndex=html.indexOf('ui-runtime.js');
  const appIndex=html.indexOf('app.js');
  assert.ok(runtimeIndex>=0&&appIndex>runtimeIndex,'ui-runtime.js must load before app.js');
  const runtime=readFileSync('apps/web/ui-runtime.js','utf8');
  assert.match(runtime,/window\.fetch\s*=/);
  assert.match(runtime,/response\.clone\(\)/);
  assert.match(runtime,/toast-stack/);
  assert.match(runtime,/\/api\/oauth\/requests/);
  assert.match(runtime,/\/api\/approvals/);
  assert.match(runtime,/Notification\.permission/);
  assert.match(runtime,/data-page=["']approvals["']/);
  assert.match(runtime,/cloudflare\/status/);
});

test('Settings and Getting Started use OAuth-first remote access without URL secrets',()=>{
  const app=readFileSync('apps/web/app.js','utf8');
  for(const text of ['Getting Started','Remote Access','Connect an AI','ChatGPT','OAuth','Authenticate with Cloudflare','Test endpoint','Guide']) assert.match(app,new RegExp(text,'i'));
  assert.match(app,/\/api\/cloudflare\/authenticate/);
  assert.match(app,/\/api\/cloudflare\/setup/);
  assert.match(app,/\/api\/cloudflare\/test/);
  assert.match(app,/\/api\/oauth\/requests/);
  assert.match(app,/\/api\/onboarding/);
  assert.match(app,/\/api\/guide/);
  assert.match(app,/`https:\/\/\$\{[^}]+\}\/mcp`/);
  assert.doesNotMatch(app,/\/mcp\/\$\{created\.token\}/);
  const css=readFileSync('apps/web/app.css','utf8');
  assert.match(css,/\.setup-sections/);
  assert.match(css,/\.pairing-request/);
  assert.match(css,/\.guide-layout/);
});

test('Getting Started removes the duplicate Local Gateway card and Remote Access uses the compact layout',()=>{
  const app=readFileSync('apps/web/app.js','utf8');
  const css=readFileSync('apps/web/app.css','utf8');
  const start=app.slice(app.indexOf('async function gettingStarted'),app.indexOf('function markdownToHtml'));
  assert.doesNotMatch(start,/Local Gateway/);
  assert.doesNotMatch(start,/local-gateway/);
  for(const className of ['remote-access-head','remote-provider','remote-config-grid','remote-actions']){
    assert.match(app,new RegExp(className));
    assert.match(css,new RegExp(`\\.${className}`));
  }
});

test('rendered timestamps use the browser device locale and timezone',()=>{
  const app=readFileSync('apps/web/app.js','utf8');
  assert.match(app,/function\s+localDateTime\s*\(/);
  assert.match(app,/toLocaleString\s*\(/);
  assert.match(app,/localDateTime\(session\.lastUsedAt\)/);
  assert.match(app,/localDateTime\(connector\.createdAt\)/);
  assert.match(app,/localDateTime\(connector\.lastUsedAt\)/);
  assert.match(app,/localDateTime\(e\.createdAt\)/);
});

test('first render opens Getting Started until onboarding is complete',()=>{const app=readFileSync('apps/web/app.js','utf8');assert.match(app,/state\s*=\s*\{\s*page:\s*null/);assert.match(app,/onboarding\.completed\s*\?\s*'dashboard'\s*:\s*'getting-started'/);});

test('OAuth pairing UI exposes local allow and deny controls with client and redirect context',()=>{const app=readFileSync('apps/web/app.js','utf8');assert.match(app,/data-oauth-approve/);assert.match(app,/data-oauth-deny/);assert.match(app,/pairingCode/);assert.match(app,/clientName/);assert.match(app,/redirectUri/);assert.match(app,/\/api\/oauth\/requests\/\$\{[^}]+\}\/approve/);assert.match(app,/\/api\/oauth\/requests\/\$\{[^}]+\}\/deny/);});

test('authenticated Cloudflare setup uses verification copy instead of promising re-authentication',()=>{const app=readFileSync('apps/web/app.js','utf8');assert.match(app,/Check authentication/);assert.doesNotMatch(app,/>Re-authenticate</);});

test('Guide page loads the API manifest and shipped local manual chapters',()=>{const app=readFileSync('apps/web/app.js','utf8');assert.match(app,/async function guide/);assert.match(app,/\/api\/guide/);assert.match(app,/\/manual\/\$\{[^}]+\.file\}/);});

test('user manual follows the onboarding journey and is copied into the shipped web app',()=>{
  const chapters=[
    '00-quick-start.md','01-install.md','02-first-start.md','03-remote-access.md','04-connect-chatgpt.md','05-connect-claude.md','06-connect-gemini.md','07-workspaces.md','08-permissions-approvals.md','09-skills.md','10-changes-recovery.md','11-processes.md','12-service.md','13-security-authentication.md','14-troubleshooting.md','15-explore.md'
  ];
  const copy=readFileSync('scripts/copy-static.mjs','utf8');
  assert.match(copy,/docs\/user-manual/);
  assert.match(copy,/dist\/apps\/web\/manual/);
  for(const file of chapters) assert.doesNotThrow(()=>readFileSync(`docs/user-manual/${file}`,'utf8'),file);
  const chatgpt=readFileSync('docs/user-manual/04-connect-chatgpt.md','utf8');
  assert.match(chatgpt,/https:\/\/<your-hostname>\/mcp/);
  assert.match(chatgpt,/OAuth/i);
  assert.doesNotMatch(chatgpt,/\/mcp\/<token>|\/mcp\/<connector-token>/i);
  const security=readFileSync('docs/user-manual/13-security-authentication.md','utf8');
  assert.match(security,/PKCE/i);assert.match(security,/local approval/i);assert.match(security,/Bearer/i);
});

test('README presents OAuth /mcp as the recommended AI connection and URL tokens as legacy only',()=>{
  const readme=readFileSync('README.md','utf8');
  assert.match(readme,/Getting Started/);
  assert.match(readme,/https:\/\/<host>\/mcp/);
  assert.match(readme,/Authorization Code.*PKCE/is);
  assert.match(readme,/local approval/i);
  assert.match(readme,/Authorization: Bearer <token>/);
  const connect=readme.slice(readme.indexOf('## Connect an AI web interface'),readme.indexOf('## MCP tools'));
  assert.match(connect,/ChatGPT.*OAuth/is);
  assert.doesNotMatch(connect,/copy the one-time URL|No authentication|mcp\/<connector-token>/i);
});
