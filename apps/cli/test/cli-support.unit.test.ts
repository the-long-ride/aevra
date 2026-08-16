import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloudflareSetupNeedsAccess,
  completionText,
  readyLines,
  usageText,
} from '../src/cli-support.js';

test('help and shell completions expose only the single UI launch flag', () => {
  assert.match(usageText(), /aevra start \[--ui\]/);
  assert.doesNotMatch(usageText(), /ui-react|vanilla/i);
  for (const shell of ['bash', 'zsh', 'powershell'] as const) {
    const completion = completionText(shell);
    assert.match(completion, /--ui/);
    assert.doesNotMatch(completion, /--ui-react|vanilla/i);
  }
});

test('aevra start ready output begins with the terminal-safe .a banner', () => {
  const lines = readyLines({
    adminUrl: 'https://localhost:47831',
    mcpUrl: 'https://localhost:47832',
  });
  assert.equal(lines[0], '');
  assert.ok(lines.slice(1, 9).some((line) => line.includes('.a')));
  assert.ok(lines.slice(1, 9).some((line) => /[#]+/.test(line)));
  assert.equal(lines.at(-4), '[aevra] Core: ready');
  assert.equal(lines.at(-1), '[aevra] Press Ctrl+C to stop Aevra.');
  assert.doesNotMatch(lines.join('\n'), /\x1b\[/);
});

test('CLI setup recognizes only Cloudflare Access as the Access verifier branch', () => {
  assert.equal(cloudflareSetupNeedsAccess('oauth'), false);
  assert.equal(cloudflareSetupNeedsAccess('connector'), false);
  assert.equal(cloudflareSetupNeedsAccess('access'), true);
  assert.equal(cloudflareSetupNeedsAccess(''), false);
});
