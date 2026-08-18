import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countPhysicalLines,
  looksArtificiallyCompressed,
  sourceLimit,
} from '../lib/source-policy.mjs';

test('source limits match the approved file policy', () => {
  assert.equal(sourceLimit('apps/core/src/runtime.ts'), 350);
  assert.equal(sourceLimit('apps/web-react/src/App.tsx'), 400);
  assert.equal(sourceLimit('apps/web/main.js'), 350);
  assert.equal(sourceLimit('apps/web/styles/base.css'), 500);
});

test('generated and vendor paths are excluded', () => {
  assert.equal(sourceLimit('dist/apps/web/app.js'), null);
  assert.equal(sourceLimit('node_modules/x/index.js'), null);
  assert.equal(sourceLimit('coverage/index.js'), null);
});

test('physical line counting ignores a trailing empty split', () => {
  assert.equal(countPhysicalLines('a\nb\n'), 2);
  assert.equal(countPhysicalLines('a\nb'), 2);
  assert.equal(countPhysicalLines(''), 0);
});

test('artificially compressed source is rejected', () => {
  assert.equal(
    looksArtificiallyCompressed('const a=1;const b=2;const c=3;'.repeat(30)),
    true,
  );
  assert.equal(looksArtificiallyCompressed('const a = 1;\nconst b = 2;\n'), false);
});
