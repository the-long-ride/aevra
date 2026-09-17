import assert from 'node:assert/strict';
import test from 'node:test';
import { isCredentialField, type SnapshotElementLike } from '../src/dom-snapshot.js';

function input(attributes: Record<string, string>): SnapshotElementLike {
  return { tagName: 'input', attributes, children: [], textContent: '' };
}

test('password, one-time-code and payment fields are refused', () => {
  const refused = [
    input({ type: 'password' }),
    input({ type: 'text', autocomplete: 'one-time-code' }),
    input({ type: 'text', autocomplete: 'cc-number' }),
    input({ type: 'text', autocomplete: 'cc-csc' }),
    input({ type: 'text', name: 'cardNumber' }),
    input({ type: 'text', id: 'cvv' }),
    input({ type: 'text', name: 'user_passwd' }),
    input({ type: 'text', 'aria-label': 'One time password' }),
  ];
  for (const field of refused) {
    assert.equal(isCredentialField(field), true, JSON.stringify(field.attributes));
  }
});

test('ordinary text fields are typable', () => {
  assert.equal(isCredentialField(input({ type: 'text', name: 'search' })), false);
  assert.equal(isCredentialField(input({ type: 'email', name: 'email' })), false);
});
