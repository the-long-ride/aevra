import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = readFileSync(
  'apps/web/data/safe-command-matchers.js',
  'utf8',
);
const guide = readFileSync('apps/web/pages/guide.js', 'utf8');
const manual = readFileSync(
  'docs/user-manual/16-safe-command-matchers.md',
  'utf8',
);

for (const matcher of [
  'git:status',
  'git:diff',
  'npm:test',
  'cargo:check',
  'dotnet:test',
]) {
  test(`safe matcher catalog includes ${matcher}`, () => {
    assert.match(catalog, new RegExp(matcher.replaceAll(':', '\\:')));
  });
}

test('safe matcher recommendations avoid unrestricted shell and network grants', () => {
  for (const dangerous of [
    'shell:',
    'network.host:*',
    'commands.run:*',
    'git:push:*',
  ]) {
    assert.doesNotMatch(catalog, new RegExp(dangerous.replaceAll('*', '\\*')));
  }
});

test('Guide renders platform tabs matcher rows risk notes and Copy all', () => {
  assert.match(guide, /Windows/);
  assert.match(guide, /Linux/);
  assert.match(guide, /macOS/);
  assert.match(guide, /data-copy-matcher/);
  assert.match(guide, /data-copy-all-matchers/);
  assert.match(guide, /Copy all/);
  assert.match(guide, /riskNote/);
  assert.match(guide, /selectedPlatformMatchers/);
  assert.match(guide, /navigator\.clipboard\.writeText/);
});

test('user manual explains exact normalized command matching and user responsibility', () => {
  assert.match(manual, /exact matcher/i);
  assert.match(manual, /first non-flag subcommand/i);
  assert.match(manual, /user-provided allow rules/i);
  assert.match(manual, /can execute project-defined code/i);
  assert.match(manual, /Windows/i);
  assert.match(manual, /Linux/i);
  assert.match(manual, /macOS/i);
});
