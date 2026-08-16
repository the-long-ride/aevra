import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAdminDestination } from '../src/admin/bootstrap-destination.js';

test('bootstrap accepts only the local React root destination', () => {
  assert.equal(parseAdminDestination(undefined), '/');
  assert.equal(parseAdminDestination('/'), '/');
});

test('bootstrap rejects removed compatibility, external and ambiguous destinations', () => {
  for (const value of [
    '/react',
    '/react/',
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
