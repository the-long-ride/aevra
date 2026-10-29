import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeStructuredSecrets } from '../src/dlp.js';

test('headers of any type are redacted whole', () => {
  const out = sanitizeStructuredSecrets({
    a: { headers: 'x-sample: sample header value' },
    b: { headers: ['x-sample: sample header value'] },
    c: { headers: 42 },
  }) as any;
  assert.equal(out.a.headers, '[REDACTED]');
  assert.equal(out.b.headers, '[REDACTED]');
  assert.equal(out.c.headers, '[REDACTED]');
  assert.equal(JSON.stringify(out).includes('sample header value'), false);
});

test('an unparseable url loses everything from the first ? or #', () => {
  const out = sanitizeStructuredSecrets({
    a: { url: 'not a url?sig=sample-query' },
    b: { url: 'nowhere/path#frag?x=1' },
    c: { url: 'plain text only' },
  }) as any;
  assert.equal(out.a.url, 'not a url');
  assert.equal(out.b.url, 'nowhere/path');
  assert.equal(out.c.url, 'plain text only');
});
