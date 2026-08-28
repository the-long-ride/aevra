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

test('aevra start ready output renders the service endpoints as a table', () => {
  const lines = readyLines({
    gatewayUrl: 'http://127.0.0.1:47830',
    adminUrl: 'https://localhost:47831',
    mcpUrl: 'https://localhost:47832',
  });
  assert.deepEqual(lines, [
    '',
    '               ',
    '                   ▄         ',
    ' ▄▀▀█▄ ▄█▀█▄▀█▄ ██▀████▄▄▀▀█▄',
    ' ▄█▀██ ██▄█▀ ██▄██ ██   ▄█▀██',
    '▄▀█▄██▄▀█▄▄▄  ▀█▀ ▄█▀  ▄▀█▄██',
    '',
    '┌───────────┬─────────────────────────────┐',
    '│ Service   │ Value                       │',
    '├───────────┼─────────────────────────────┤',
    '│ Core      │ ready                       │',
    '│ Gateway   │ http://127.0.0.1:47830      │',
    '│ MCP       │ https://localhost:47832/mcp │',
    '│ Dashboard │ https://localhost:47831     │',
    '└───────────┴─────────────────────────────┘',
    '',
  ]);
  assert.doesNotMatch(lines.join('\n'), /Press Ctrl\+C/);
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
