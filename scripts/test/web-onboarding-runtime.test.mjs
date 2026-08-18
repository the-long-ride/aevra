import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

test('completed onboarding collapses by default but stays expandable while Remote Access remains visible',()=>{
  const runtime=readFileSync('apps/web/ui-runtime.js','utf8');
  const app=readFileSync('apps/web/app.js','utf8');
  assert.match(runtime,/\/api\/onboarding/);
  assert.match(runtime,/#finish-onboarding/);
  assert.match(runtime,/stopImmediatePropagation\(\)/);
  assert.match(runtime,/onboardingCompleted/);
  assert.match(runtime,/onboarding-collapsible/);
  assert.match(runtime,/Onboarding completed/);
  assert.match(runtime,/Show setup/);
  assert.match(runtime,/Hide setup/);
  assert.match(app,/data-onboarding-persistent/);
  assert.match(runtime,/:scope > \.setup-section:not\(\[data-onboarding-persistent\]\)/);
  assert.match(runtime,/data-onboarding-persistent/);
});

test('web header shows the running Aevra version from status rather than a hard-coded UI version',()=>{
  const runtime=readFileSync('apps/web/ui-runtime.js','utf8');
  const core=readFileSync('apps/core/src/runtime.ts','utf8');
  assert.match(runtime,/\/api\/status/);
  assert.match(runtime,/status\?\.version/);
  assert.match(runtime,/app-version/);
  assert.match(core,/version:AEVRA_VERSION/);
  assert.doesNotMatch(runtime,/v0\.\d+\.\d+/);
});

test('runtime continuously maps Core Worker MCP and Tunnel status into compact health chips',()=>{
  const runtime=readFileSync('apps/web/ui-runtime.js','utf8');
  const css=readFileSync('apps/web/app.css','utf8');
  assert.match(runtime,/function\s+updateHealth/);
  assert.match(runtime,/tunnelReachable/);
  assert.match(runtime,/data-health/);
  assert.match(runtime,/refreshAppStatus\(\)/);
  assert.match(css,/header\s*\{[^}]*position:\s*sticky/s);
  assert.match(css,/\.health-dot/);
  assert.match(css,/\[data-state=["']?ok/);
  assert.match(css,/\[data-state=["']?error/);
  assert.match(css,/@keyframes\s+status-pulse/);
});

test('first polling cycle surfaces existing pending requests instead of silently seeding them',()=>{
  const runtime=readFileSync('apps/web/ui-runtime.js','utf8');
  assert.doesNotMatch(runtime,/if\s*\(!seeded\)\s*continue/);
  assert.match(runtime,/Incoming workspace access request|Incoming approval request/);
});
