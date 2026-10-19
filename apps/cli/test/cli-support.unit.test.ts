import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloudflareSetupNeedsAccess,
  completionText,
  creditLine,
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

test('usage advertises mcp enable and disable', () => {
  assert.match(
    usageText(),
    /aevra mcp list\|add <name> --transport …\|remove <id>\|test <id>\|enable <id>\|disable <id>/,
  );
});

test('aevra start ready output renders the service endpoints as a table', () => {
  const lines = readyLines({
    gatewayUrl: 'http://127.0.0.1:47830',
    adminUrl: 'https://localhost:47831',
    mcpUrl: 'https://localhost:47832',
    desktopHelperReady: true,
  });
  assert.deepEqual(lines, [
    '',
    '               ',
    '                   ▄         ',
    ' ▄▀▀█▄ ▄█▀█▄▀█▄ ██▀████▄▄▀▀█▄',
    ' ▄█▀██ ██▄█▀ ██▄██ ██   ▄█▀██',
    '▄▀█▄██▄▀█▄▄▄  ▀█▀ ▄█▀  ▄▀█▄██',
    '',
    '┌────────────────┬─────────────────────────────┐',
    '│ Service        │ Value                       │',
    '├────────────────┼─────────────────────────────┤',
    '│ Core           │ ready                       │',
    '│ Desktop helper │ ready                       │',
    '│ Gateway        │ http://127.0.0.1:47830      │',
    '│ MCP            │ https://localhost:47832/mcp │',
    '│ Dashboard      │ https://localhost:47831     │',
    '└────────────────┴─────────────────────────────┘',
    '',
    creditLine(),
    '',
  ]);
  assert.doesNotMatch(lines.join('\n'), /Press Ctrl\+C/);
  assert.doesNotMatch(lines.join('\n'), /\x1b\[/);
});

test('startup reports a missing desktop helper without losing the other services', () => {
  const lines = readyLines({
    adminUrl: 'https://localhost:47831',
    mcpUrl: 'https://localhost:47832',
    desktopHelperReady: false,
  });
  const rows = lines.filter((line) => line.startsWith('│') && !line.includes('Service'));
  assert.match(rows[0]!, /Core\s+│ ready/);
  assert.match(rows[1]!, /Desktop helper\s+│ missing/);
  assert.ok(rows[2]!.includes('MCP'));
  assert.equal(
    rows.some((line) => line.includes('Gateway')),
    false,
  );
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

test('credit line links the author and repository when hyperlinks are supported', () => {
  assert.equal(
    creditLine(false),
    'Author: the-long-ride (https://github.com/the-long-ride) // Repo: the-long-ride/aevra (https://github.com/the-long-ride/aevra)',
  );
  const linked = creditLine(true);
  const esc = String.fromCharCode(27);
  const st = esc + String.fromCharCode(92);
  assert.ok(
    linked.includes(`${esc}]8;;https://github.com/the-long-ride${st}the-long-ride${esc}]8;;${st}`),
  );
  assert.ok(
    linked.includes(
      `${esc}]8;;https://github.com/the-long-ride/aevra${st}the-long-ride/aevra${esc}]8;;${st}`,
    ),
  );
});
