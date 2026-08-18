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
