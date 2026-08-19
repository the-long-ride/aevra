import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cloudflareSetupNeedsAccess, completionText, usageText } from '../src/cli-support.js';

test('help and shell completions expose only the single UI launch flag', () => {
  assert.match(usageText(), /aevra start \[--ui\]/);
  assert.doesNotMatch(usageText(), /ui-react|vanilla/i);
  for (const shell of ['bash', 'zsh', 'powershell'] as const) {
    const completion = completionText(shell);
    assert.match(completion, /--ui/);
    assert.doesNotMatch(completion, /--ui-react|vanilla/i);
  }
});

test('CLI setup asks for issuer and audience only in Access mode', () => {
  assert.equal(cloudflareSetupNeedsAccess('connector'), false);
  assert.equal(cloudflareSetupNeedsAccess('access'), true);
  assert.equal(cloudflareSetupNeedsAccess(''), false);
});

test('interactive setup keeps connector as default and gates Access-only prompts', () => {
  const source = readFileSync('apps/cli/src/commands/setup-command.ts', 'utf8');
  assert.match(source, /Remote MCP authentication \[connector\/access\] \(connector\)/);
  assert.match(source, /dependencies\.needsAccess\(authAnswer\)/);
  assert.match(source, /authMode === 'access'/);
  assert.match(source, /issuer: issuer \|\| undefined/);
  assert.match(source, /audience: audience \|\| undefined/);
});
