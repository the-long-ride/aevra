import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAevraArgs } from '../src/args.js';
import { usageText } from '../src/cli-support.js';

test('parses audit clear confirmation', () => {
  assert.deepEqual(parseAevraArgs(['audit', 'clear']), {
    command: 'audit',
    action: 'clear',
    yes: false,
  });
  assert.deepEqual(parseAevraArgs(['audit', 'clear', '--yes']), {
    command: 'audit',
    action: 'clear',
    yes: true,
  });
});

test('parses revoke-others session cleanup confirmation', () => {
  assert.deepEqual(parseAevraArgs(['sessions', 'revoke-others']), {
    command: 'sessions',
    action: 'revoke-others',
    yes: false,
  });
  assert.deepEqual(parseAevraArgs(['sessions', 'revoke-others', '--yes']), {
    command: 'sessions',
    action: 'revoke-others',
    yes: true,
  });
});

test('usage advertises destructive maintenance commands', () => {
  const usage = usageText();
  assert.match(usage, /aevra audit clear --yes/);
  assert.match(usage, /aevra sessions revoke-others --yes/);
});
