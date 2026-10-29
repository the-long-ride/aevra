import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeStructuredSecrets } from '../src/dlp.js';

test('headers are opaque: every value is redacted, names stay', () => {
  const out = sanitizeStructuredSecrets({
    entries: [{ path: '/a.txt', headers: { 'x-sample-header': 'sample header value' } }],
  }) as any;
  const text = JSON.stringify(out);
  assert.equal(text.includes('sample header value'), false);
  assert.equal(out.entries[0].headers['x-sample-header'], '[REDACTED]');
  assert.equal(out.entries[0].path, '/a.txt');
});

test('url values lose query, fragment and userinfo', () => {
  const out = sanitizeStructuredSecrets({
    url: 'https://user:word@files.example/path/a.txt?sig=sample-query#frag',
    other: { url: 'https://files.example/b.txt?x=1' },
  }) as any;
  assert.equal(out.url, 'https://files.example/path/a.txt');
  assert.equal(out.other.url, 'https://files.example/b.txt');
});

test('non-http url values and plain urls are left alone', () => {
  const out = sanitizeStructuredSecrets({
    a: { url: 'not a url' },
    b: { url: 'https://files.example/plain' },
  }) as any;
  assert.equal(out.a.url, 'not a url');
  assert.equal(out.b.url, 'https://files.example/plain');
});
