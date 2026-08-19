import assert from 'node:assert/strict';
import test from 'node:test';
import { redactText } from '../../packages/security/src/dlp.js';
test('known generated secrets never survive redaction', () => {
  for (let i = 0; i < 100; i++) {
    const secret = `secret-${i}-${'x'.repeat(24)}-${i * i}`;
    const out = redactText(`before ${secret} after`, [secret]);
    assert.equal(out.text.includes(secret), false);
  }
});
