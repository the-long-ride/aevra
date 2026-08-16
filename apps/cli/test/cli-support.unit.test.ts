import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloudflareSetupNeedsAccess,
  completionText,
  formatCliError,
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

test('aevra start ready output begins with the Aevra banner', () => {
  const lines = readyLines({
    adminUrl: 'https://localhost:47831',
    mcpUrl: 'https://localhost:47832',
  });
  assert.deepEqual(lines.slice(0, 7), [
    '',
    '               ',
    '                   ▄         ',
    ' ▄▀▀█▄ ▄█▀█▄▀█▄ ██▀████▄▄▀▀█▄',
    ' ▄█▀██ ██▄█▀ ██▄██ ██   ▄█▀██',
    '▄▀█▄██▄▀█▄▄▄  ▀█▀ ▄█▀  ▄▀█▄██',
    '',
  ]);
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

test('missing admin credentials print a friendly message instead of a stack', () => {
  const error = Object.assign(
    new Error(
      'ADMIN_CREDENTIALS_REQUIRED: AEVRA_USERNAME and AEVRA_PASSWORD must both be configured',
    ),
    { code: 'ADMIN_CREDENTIALS_REQUIRED' },
  );
  const message = formatCliError(error);
  assert.match(message, /ADMIN_CREDENTIALS_REQUIRED/);
  assert.match(message, /Set both AEVRA_USERNAME and AEVRA_PASSWORD/);
  assert.doesNotMatch(message, /at loadAdminCredentials/);
});
