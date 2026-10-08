import assert from 'node:assert/strict';
import test from 'node:test';
import { TOKEN_ESTIMATOR, estimateTokens } from '../src/token-estimate.js';

test('estimator id is versioned', () => {
  assert.equal(TOKEN_ESTIMATOR, 'heuristic-v1');
});

test('empty text costs nothing', () => {
  assert.equal(estimateTokens(''), 0);
});

test('pure ASCII is one token per four characters, rounded up', () => {
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(estimateTokens('x'.repeat(4000)), 1000);
});

test('accented Latin letters weigh half a token', () => {
  // 7 ASCII x 0.25 + one letter with diacritics x 0.5 = 2.25
  assert.equal(estimateTokens('Việt Nam'), 3);
});

test('Cyrillic letters weigh half a token', () => {
  assert.equal(estimateTokens('Привет'), 3);
});

test('CJK, Hangul and emoji weigh one token each', () => {
  assert.equal(estimateTokens('日本語'), 3);
  assert.equal(estimateTokens('한'), 1);
  assert.equal(estimateTokens('\u{1F600}'), 1);
});

test('mixed text sums the weights then rounds up', () => {
  assert.equal(estimateTokens('a日'), 2);
});
