import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// apps/extension is never scanned by scripts/test.mjs, so the content script's
// refusal - the wall that still holds if the service worker is compromised -
// has no unit test. This guards it at the source level instead of not at all.
const content = readFileSync('apps/extension/src/content.ts', 'utf8');

test('the content script refuses typing into credential fields', () => {
  assert.match(content, /BROWSER_CREDENTIAL_FIELD_REFUSED/);
  assert.match(content, /refusesTyping/);
  for (const pattern of ['one-time-code', 'current-password', 'new-password', 'cc-']) {
    assert.ok(content.includes(pattern), `content script no longer refuses ${pattern}`);
  }
  assert.match(content, /type\.toLowerCase\(\) === 'password'/);
});

test('the refusal is checked before the value is written', () => {
  const refusal = content.indexOf('BROWSER_CREDENTIAL_FIELD_REFUSED');
  const write = content.indexOf('field.value +=');
  assert.ok(refusal > 0 && write > 0);
  assert.ok(refusal < write, 'the credential check must precede any value write');
});

test('the extension evaluates no page-authored script', () => {
  // Assembled rather than written literally: scripts/lint.mjs forbids the
  // literal call form anywhere in the repo, including in a test that looks
  // for it.
  const forbidden = ['ev' + 'al(', 'new Fun' + 'ction', 'innerHTML ='];
  for (const pattern of forbidden) {
    assert.equal(content.includes(pattern), false, `content script uses ${pattern}`);
  }
});
