import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

test('safe command matcher catalog covers Windows Linux and macOS conservatively',()=>{
  const catalog=readFileSync('apps/web/safe-command-matchers.js','utf8');
  for(const platform of ['windows','linux','macos'])assert.match(catalog,new RegExp(`['"]${platform}['"]`));
  for(const matcher of ['git:status','git:diff','git:log','npm:test','cargo:check','dotnet:test'])assert.match(catalog,new RegExp(matcher.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  for(const broad of ['shell:powershell','shell:bash','shell:sh'])assert.doesNotMatch(catalog,new RegExp(broad.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('guide renders platform tabs and copy controls from the shared catalog',()=>{
  const app=readFileSync('apps/web/app.js','utf8');const html=readFileSync('apps/web/index.html','utf8');const manual=readFileSync('docs/user-manual/16-safe-command-matchers.md','utf8');const copy=readFileSync('scripts/copy-static.mjs','utf8');
  assert.match(html,/safe-command-matchers\.js[\s\S]*app\.js/);
  assert.match(app,/AevraSafeCommandMatchers/);
  assert.match(app,/data-safe-platform/);assert.match(app,/data-copy-matcher/);
  assert.match(app,/Windows/);assert.match(app,/Linux/);assert.match(app,/macOS/);
  assert.match(manual,/not a security guarantee/i);
  assert.match(copy,/docs\/user-manual[\s\S]*dist\/apps\/web\/manual/);
});
