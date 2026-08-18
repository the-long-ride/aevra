import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAdminDestination } from '../src/admin/bootstrap-destination.js';

test('bootstrap accepts only vanilla and React local destinations', () => {
  assert.equal(parseAdminDestination(undefined), '/');
  assert.equal(parseAdminDestination('/'), '/');
  assert.equal(parseAdminDestination('/react/'), '/react/');
  assert.equal(parseAdminDestination('/react'), '/react/');
});

test('bootstrap rejects external and ambiguous destinations', () => {
  for (const value of [
    'https://evil.example',
    '//evil.example',
    '/react/../../secret',
    '/settings',
    '\\evil.example',
    'javascript:alert(1)',
  ]) {
    assert.equal(parseAdminDestination(value), null, value);
  }
});
