import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const app=()=>readFileSync('apps/web/admin-enhancements.js','utf8');

test('permission modal targets configured connectors without requiring active sessions',()=>{
  const source=app();
  assert.match(source,/\/api\/oauth\/clients/);
  assert.match(source,/Selected connectors/);
  assert.doesNotMatch(source,/Selected connected connectors/);
  assert.match(source,/Connected/);
  assert.match(source,/Configured/);
  assert.match(source,/Never used/);
  assert.match(source,/oauthClients/);
});

test('commands.run has a multiline matcher editor and command-only payload',()=>{
  const source=app();
  assert.match(source,/name="commandMatchers"/);
  assert.match(source,/Command matchers/);
  assert.match(source,/one matcher per line/i);
  assert.match(source,/commandMatchers/);
  assert.match(source,/includes\('commands\.run'\)/);
  assert.match(source,/matcherCount/);
  assert.match(source,/Broad command access/);
});
