import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';

test('admin enhancement JavaScript parses before shipping',()=>{
  const result=spawnSync(process.execPath,['--check','apps/web/admin-enhancements.js'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
});

test('admin shell loads enhancement assets after the base app',()=>{
  const html=readFileSync('apps/web/index.html','utf8');
  assert.match(html,/admin-enhancements\.css/);
  assert.match(html,/app\.js[\s\S]*admin-enhancements\.js/);
});

test('enhanced admin UX covers batch permissions workspace mounts and cleanup',()=>{
  const app=readFileSync('apps/web/admin-enhancements.js','utf8');
  for(const text of ['All connectors','Selected connected connectors','External mounts','Revoke all others','Clear history'])assert.match(app,new RegExp(text,'i'));
  assert.match(app,/\/api\/permissions\/bulk/);
  assert.match(app,/\/api\/sessions\/revoke-others/);
  assert.match(app,/\/api\/audit/);
  assert.match(app,/\/admissions/);
  assert.match(app,/\.remote-card/);
});

test('permission bulk modal uses a wide guided layout with readable selection controls',()=>{
  const app=readFileSync('apps/web/admin-enhancements.js','utf8');
  const css=readFileSync('apps/web/admin-enhancements.css','utf8');
  for(const text of ['1. Who gets access?','2. Where does it apply?','3. What can they do?','4. Rule details','Select all','Clear','Create 0 rules'])assert.match(app,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  assert.match(app,/data-enh-target-card/);
  assert.match(app,/data-enh-scope-card/);
  assert.match(app,/data-enh-select-all-capabilities/);
  assert.match(app,/data-enh-clear-capabilities/);
  assert.match(app,/data-enh-create-rules/);
  assert.match(css,/\.enh-modal\.permission-bulk\{[^}]*width:min\(1240px,calc\(100vw - 32px\)\)/);
  assert.match(css,/\.enh-permission-layout/);
  assert.match(css,/\.enh-choice-cards/);
  assert.match(css,/\.enh-capability-grid/);
  assert.match(css,/\.enh-rule-summary/);
});

test('v2 shell does not shadow enhanced admin pages or keep duplicate renderers',()=>{
  const v2=readFileSync('apps/web/app-v2.js','utf8');
  assert.match(v2,/managedPages=new Set\(\['dashboard','processes','changes'\]\)/);
  for(const page of ['workspaces','permissions','sessions','audit'])assert.doesNotMatch(v2,new RegExp(`page==='${page}'`));
  for(const fn of ['renderWorkspaces','openWorkspaceModal','renderPermissions','openPermissionModal','renderSessions','openSessionWorkspaceModal','renderAudit'])assert.doesNotMatch(v2,new RegExp(`function ${fn}\\b|async function ${fn}\\b`));
  assert.doesNotMatch(v2,/if\(jump\)activate\(jump\)/);
  assert.match(v2,/CSS\.escape\(jump\)/);
});

test('v2 stylesheet drops styles used only by removed duplicate admin pages',()=>{
  const css=readFileSync('apps/web/app-v2.css','utf8');
  for(const selector of ['workspace-summary','modal-section','modal-form','modal-details','audit-integrity','button-link','cell-primary'])assert.doesNotMatch(css,new RegExp(`\\.${selector}\\b`));
});
