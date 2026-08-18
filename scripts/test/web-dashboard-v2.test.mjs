import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const index=readFileSync('apps/web/index.html','utf8');
const app=readFileSync('apps/web/app-v2.js','utf8');
const appV3=readFileSync('apps/web/app-v3.js','utf8');
const table=readFileSync('apps/web/data-table.js','utf8');
const css=readFileSync('apps/web/app-v2.css','utf8');

test('dashboard v2 merges remote access, runtime, connectors, and request drawer',()=>{
  assert.match(index,/app-v2\.css/);
  assert.match(index,/data-table\.js/);
  assert.match(index,/app-v2\.js/);
  assert.match(app,/\['getting-started','approvals','connectors'\]/);
  for(const text of ['Remote Access','Onboarding','Runtime overview','Connections','Recent activity'])assert.match(app,new RegExp(text));
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

test('request drawer exposes exact persistent command scopes and saved matcher',()=>{
  for(const text of ['Allow this session','Always in workspace','Always globally','Saved matcher'])assert.match(appV3,new RegExp(text));
  assert.match(appV3,/data-scope="global"/);
  assert.match(appV3,/permissionMatcher/);
  assert.match(appV3,/CRITICAL/);
});

test('safe matcher guide can copy every matcher for the selected platform',()=>{
  assert.match(appV3,/data-copy-all-matchers/);
  assert.match(appV3,/Copy all/);
  assert.match(appV3,/copyMatcher/);
});

test('dashboard sections are independently collapsible and default expanded',()=>{
  assert.match(appV3,/dashboard-section/);
  assert.match(appV3,/details\.open=true|setAttribute\(['"]open['"]/);
  assert.doesNotMatch(appV3,/onboarding\.open=false/);
  assert.doesNotMatch(appV3,/body\.prepend\(remote\)/);
});

test('scrollbars are thin with transparent tracks',()=>{
  assert.match(css,/scrollbar-width:\s*thin/);
  assert.match(css,/scrollbar-color:[^;]*transparent/);
  assert.match(css,/::-webkit-scrollbar\s*\{[^}]*width:\s*6px/);
  assert.match(css,/::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/);
  assert.match(css,/::-webkit-scrollbar-corner\s*\{[^}]*background:\s*transparent/);
});

test('v2 no longer contains workspace admin renderer dead code',()=>{
  for(const fn of ['renderWorkspaces','openWorkspaceModal'])assert.doesNotMatch(app,new RegExp(`function ${fn}\\b|async function ${fn}\\b`));
});
