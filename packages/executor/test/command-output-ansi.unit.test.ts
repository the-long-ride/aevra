import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeCommandOutput } from '../src/commands.js';

test('command output loses whole ANSI sequences, not just the escape byte', () => {
  assert.equal(sanitizeCommandOutput('\u001b[90mgrey\u001b[39m ok'), 'grey ok');
});

test('bidi overrides are still removed', () => {
  assert.equal(sanitizeCommandOutput('a‮b'), 'ab');
});

test('the truncation marker is appended after cleaning', () => {
  assert.equal(
    sanitizeCommandOutput('\u001b[1mx\u001b[0m', [], true),
    'x\n...[output truncated by Aevra]',
  );
});
