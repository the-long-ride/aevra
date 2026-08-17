import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

test('completed onboarding collapses by default but stays expandable',()=>{
  const runtime=readFileSync('apps/web/ui-runtime.js','utf8');
  assert.match(runtime,/\/api\/onboarding/);
  assert.match(runtime,/#finish-onboarding/);
  assert.match(runtime,/stopImmediatePropagation\(\)/);
  assert.match(runtime,/onboardingCompleted/);
  assert.match(runtime,/onboarding-collapsible/);
  assert.match(runtime,/Onboarding completed/);
  assert.match(runtime,/Show setup/);
  assert.match(runtime,/Hide setup/);
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
