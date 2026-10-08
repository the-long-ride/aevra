import assert from 'node:assert/strict';
import test from 'node:test';
import { stripAnsiSequences } from '../src/untrusted.js';

const ESC = '\u001b';

test('colour sequences are removed completely', () => {
  assert.equal(stripAnsiSequences(`${ESC}[90mgrey${ESC}[39m done`), 'grey done');
});

test('cursor and erase sequences are removed', () => {
  assert.equal(stripAnsiSequences(`${ESC}[2K${ESC}[1Gprogress`), 'progress');
});

test('OSC titles terminated by BEL are removed', () => {
  assert.equal(stripAnsiSequences(`${ESC}]0;window title\u0007text`), 'text');
});

test('OSC titles terminated by ST are removed', () => {
  assert.equal(stripAnsiSequences(`${ESC}]0;window title${ESC}\\text`), 'text');
});

test('two-byte escapes are removed', () => {
  assert.equal(stripAnsiSequences(`${ESC}cready`), 'ready');
});

test('text without an escape byte is untouched, brackets included', () => {
  assert.equal(stripAnsiSequences('items[0] and [90m'), 'items[0] and [90m');
});
