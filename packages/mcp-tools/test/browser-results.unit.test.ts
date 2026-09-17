import assert from 'node:assert/strict';
import test from 'node:test';
import { redactBrowserResult, reclassifyOrigins } from '../src/browser-results.js';

// Built at runtime rather than written as a literal. DLP keys on shape, not
// meaning, and this file must not carry anything key-shaped of its own.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const highEntropyRun = Array.from(
  { length: 44 },
  (_, index) => ALPHABET[(index * 7) % ALPHABET.length],
).join('');

test('page text is classified by the shared DLP pass before it leaves the tool', () => {
  const result = redactBrowserResult({ content: `the console printed ${highEntropyRun} at boot` });
  assert.equal(result.redactionCount, 1);
  assert.ok(!String((result.value as any).content).includes(highEntropyRun));
  assert.match(String((result.value as any).content), /the console printed/);
});

test('the audit count is the count that pass produced, not a constant', () => {
  const clean = redactBrowserResult({ content: 'an ordinary paragraph of page text' });
  assert.equal(clean.redactionCount, 0);
  assert.equal((clean.value as any).content, 'an ordinary paragraph of page text');
});

test('nested structures are walked, not just the top level', () => {
  const result = redactBrowserResult({
    nodes: [
      { ref: 'e1', name: 'ok' },
      { ref: 'e2', name: highEntropyRun },
    ],
  });
  assert.equal(result.redactionCount, 1);
  assert.equal((result.value as any).nodes[0].name, 'ok');
  assert.equal((result.value as any).nodes[0].ref, 'e1');
  assert.notEqual((result.value as any).nodes[1].name, highEntropyRun);
});

test('a list of log entries is redacted entry by entry', () => {
  const result = redactBrowserResult([
    { kind: 'console', text: `warn ${highEntropyRun}` },
    { kind: 'console', text: 'warn nothing interesting' },
  ]);
  assert.equal(result.redactionCount, 1);
  assert.equal((result.value as any)[1].text, 'warn nothing interesting');
});

test('screenshot bytes are pixels, so DLP has nothing to read and leaves them alone', () => {
  const imageDataUri = `data:image/png;base64,${highEntropyRun}`;
  const result = redactBrowserResult({ imageDataUri, url: 'https://example.com/' });
  assert.equal((result.value as any).imageDataUri, imageDataUri);
  assert.equal(result.redactionCount, 0);
});

test('an origin class from a config-blind driver is restamped under the policy', () => {
  const tabs = [
    { tabId: '1', url: 'http://127.0.0.1:9000/settings', originClass: 'NORMAL' },
    { tabId: '2', url: 'https://example.com/', originClass: 'NORMAL' },
  ];
  reclassifyOrigins(tabs, { aevraPorts: [9000], loopbackClass: 'NORMAL' });
  assert.equal(tabs[0]!.originClass, 'BLOCKED');
  assert.equal(tabs[1]!.originClass, 'NORMAL');
});

test('a single result object is restamped too', () => {
  const snapshot = { url: 'http://admin.localhost:9000/', originClass: 'NORMAL', nodes: [] };
  reclassifyOrigins(snapshot, { aevraPorts: [9000] });
  assert.equal(snapshot.originClass, 'BLOCKED');
});

test('a result carrying no origin class is left as it is', () => {
  const value = { disconnected: true };
  assert.deepEqual(reclassifyOrigins(value, {}), { disconnected: true });
  assert.equal(reclassifyOrigins(null, {}), null);
});
