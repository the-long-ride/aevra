import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const index=readFileSync('apps/web/index.html','utf8');
const app=readFileSync('apps/web/app-v2.js','utf8');
const table=readFileSync('apps/web/data-table.js','utf8');
const css=readFileSync('apps/web/app-v2.css','utf8');

test('dashboard v2 merges onboarding, remote access, connectors, and request drawer',()=>{
  assert.match(index,/app-v2\.css/);
  assert.match(index,/data-table\.js/);
  assert.match(index,/app-v2\.js/);
  assert.match(app,/\['getting-started','approvals','connectors'\]/);
  assert.match(app,/Remote Access/);
  assert.match(app,/Onboarding/);
  assert.match(app,/Runtime overview/);
  assert.match(app,/Connections/);
  assert.match(app,/request-drawer/);
  assert.match(app,/Local skills access/);
});

test('shared data table supports search filters sorting page size and pagination',()=>{
  assert.match(table,/data-dt-search/);
  assert.match(table,/data-dt-filter/);
  assert.match(table,/data-dt-sort/);
  assert.match(table,/data-dt-size/);
  assert.match(table,/data-dt-page/);
  assert.match(table,/pageSizes/);
  assert.match(css,/\.data-table/);
  assert.match(css,/@media\(max-width:760px\)/);
});

test('workspace list is compact and details are managed in a modal',()=>{
  assert.match(app,/workspace-table/);
  assert.match(app,/openWorkspaceModal/);
  assert.match(app,/External mounts/);
  assert.match(app,/Actor admission/);
  assert.match(css,/\.v2-modal/);
});
