import assert from 'node:assert/strict';
import test from 'node:test';
import { loosePath, resolveClaudeProjectKey } from '../src/claude-project-key.js';

const withProjects = (...keys: string[]) =>
  JSON.stringify({ projects: Object.fromEntries(keys.map((key) => [key, { mcpServers: {} }])) });

test('an existing key differing in case and slash direction is reused', () => {
  const text = withProjects('F:/repos/bravo', 'F:/other/thing');
  assert.equal(resolveClaudeProjectKey(text, 'F:\\Repos\\Bravo', 'win32'), 'F:/repos/bravo');
  assert.equal(resolveClaudeProjectKey(text, 'f:/REPOS/bravo/', 'win32'), 'F:/repos/bravo');
});

test('a backslash key is reused for a forward-slash root', () => {
  const text = withProjects('F:\\Repos\\Alpha');
  assert.equal(resolveClaudeProjectKey(text, 'F:/repos/alpha', 'win32'), 'F:\\Repos\\Alpha');
});

test('an exact match wins over a looser one listed earlier', () => {
  const text = withProjects('F:/repos/bravo', 'F:\\Repos\\Bravo');
  assert.equal(resolveClaudeProjectKey(text, 'F:\\Repos\\Bravo'), 'F:\\Repos\\Bravo');
});

test('no matching key gives the forward-slash form', () => {
  const text = withProjects('F:/repos/bravo');
  assert.equal(resolveClaudeProjectKey(text, 'F:\\my-repos\\x', 'win32'), 'F:/my-repos/x');
});

test('a config without projects, empty text or invalid text gives the forward-slash form', () => {
  const win = (text: string) => resolveClaudeProjectKey(text, 'F:\\my-repos\\x', 'win32');
  assert.equal(win('{"theme":"plain"}'), 'F:/my-repos/x');
  assert.equal(win(''), 'F:/my-repos/x');
  assert.equal(win('{bad'), 'F:/my-repos/x');
  assert.equal(resolveClaudeProjectKey('{"projects":[]}', '/home/me/x'), '/home/me/x');
});

test('only own properties of the config are read', () => {
  const inherited = '{"__proto__":{"projects":{"F:/X":{}}}}';
  assert.equal(resolveClaudeProjectKey(inherited, 'f:/x', 'win32'), 'f:/x');
  assert.equal(resolveClaudeProjectKey('{"projects":{"__proto__":{}}}', '__proto__'), '__proto__');
  assert.equal(resolveClaudeProjectKey('{"projects":{"a":{}}}', '__proto__'), '__proto__');
});

test('the fallback strips trailing separators like matching does', () => {
  assert.equal(resolveClaudeProjectKey('{}', 'F:\\my-repos\\x\\', 'win32'), 'F:/my-repos/x');
  assert.equal(resolveClaudeProjectKey('{}', '/home/me/x//'), '/home/me/x');
  assert.equal(resolveClaudeProjectKey('{}', 'F:\\', 'win32'), 'F:/');
  assert.equal(resolveClaudeProjectKey('{}', '/'), '/');
});

test('loosePath ignores case, slash direction and trailing separators', () => {
  assert.equal(loosePath('F:\\X\\'), loosePath('f:/x'));
  assert.notEqual(loosePath('F:/x'), loosePath('F:/y'));
});
