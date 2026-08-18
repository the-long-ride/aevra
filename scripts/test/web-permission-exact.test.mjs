import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = () =>
  readFileSync('apps/web/components/permission-bulk.js', 'utf8');

test('permission editor targets configured connectors without requiring active sessions', () => {
  const value = source();
  assert.match(value, /connectors, oauthClients, sessions/);
  assert.match(value, /Selected connectors/);
  assert.doesNotMatch(value, /Selected connected connectors/);
  assert.match(value, /Connected/);
  assert.match(value, /Configured/);
  assert.match(value, /Never used/);
  assert.match(value, /oauthClients/);
});

test('commands.run has a multiline matcher editor and command-only payload', () => {
  const value = source();
  assert.match(value, /name="commandMatchers"/);
  assert.match(value, /Command matchers/);
  assert.match(value, /One normalized matcher per line/);
  assert.match(value, /commandMatchers/);
  assert.match(value, /includes\('commands\.run'\)/);
  assert.match(value, /Broad command access/);
  assert.match(value, /\/api\/permissions\/bulk/);
});
