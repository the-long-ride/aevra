import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync('apps/web/main.js', 'utf8');
const shellCss = readFileSync('apps/web/styles/shell.css', 'utf8');
const tokens = readFileSync('apps/web/styles/tokens.css', 'utf8');
const dashboard = readFileSync('apps/web/pages/dashboard.js', 'utf8');
const remoteAccess = readFileSync(
  'apps/web/components/remote-access.js',
  'utf8',
);
const requests = readFileSync(
  'apps/web/components/request-drawer.js',
  'utf8',
);
const notifications = readFileSync(
  'apps/web/components/request-notifications.js',
  'utf8',
);
const runtimeStatus = readFileSync(
  'apps/web/components/runtime-status.js',
  'utf8',
);
const time = readFileSync('apps/web/core/time.js', 'utf8');
const guide = readFileSync('apps/web/pages/guide.js', 'utf8');

test('local admin shell exposes control-plane pages without legacy browser relay', () => {
  for (const page of [
    'workspaces',
    'permissions',
    'sessions',
    'processes',
    'changes',
    'audit',
    'settings',
    'guide',
  ]) {
    assert.match(main, new RegExp(page));
  }
  assert.doesNotMatch(main, /browser relay|extension control websocket/i);
  assert.match(main, /SAFE MODE/);
});

test('xAI design authority keeps a compact neutral shell without a boxed navigation rail', () => {
  assert.match(tokens, /--bg:\s*#090909/i);
  assert.match(tokens, /--panel:\s*#111111/i);
  assert.match(tokens, /--accent:\s*#f4f4f5/i);
  assert.doesNotMatch(tokens, /#73f2a7|--m-blue|--m-red/i);
  assert.match(main, /class="top-nav"/);
  assert.match(shellCss, /\.top-nav\s*\{/);
  assert.doesNotMatch(main, /class="sidebar"/);
  assert.doesNotMatch(shellCss, /\.sidebar(?:\s|\{|\.)/);
});

test('runtime status provides live health pending count safety mode and notifications', () => {
  assert.match(runtimeStatus, /\/api\/status/);
  assert.match(runtimeStatus, /\/api\/approvals/);
  assert.match(runtimeStatus, /\/api\/oauth\/requests/);
  assert.match(runtimeStatus, /safeMode/);
  assert.match(runtimeStatus, /requests-count/);
  assert.match(notifications, /NotificationApi\.permission/);
  assert.match(notifications, /OAuth connection request/);
  assert.match(notifications, /Aevra approval request/);
});

test('endpoint test reports concrete reachability instead of a generic checked label', () => {
  assert.match(remoteAccess, /\/api\/cloudflare\/test/);
  assert.match(remoteAccess, /Endpoint reachable/);
  assert.match(remoteAccess, /Not reachable:/);
  assert.doesNotMatch(remoteAccess, /Remote endpoint checked/);
});

test('Dashboard onboarding keeps OAuth-first Remote Access and provider guidance', () => {
  for (const text of [
    'Remote Access',
    'Connect an AI',
    'ChatGPT',
    'Claude',
    'Gemini',
    'OAuth',
    'Test endpoint',
  ]) {
    assert.match(dashboard, new RegExp(text, 'i'));
  }
  assert.match(remoteAccess, /\/api\/cloudflare\/authenticate/);
  assert.match(remoteAccess, /\/api\/cloudflare\/setup/);
  assert.match(remoteAccess, /Check authentication/);
  assert.doesNotMatch(remoteAccess, />Re-authenticate</);
  assert.match(dashboard, /`https:\/\/\$\{cloudflare\.hostname\}\/mcp`/);
  assert.doesNotMatch(dashboard, /\/mcp\/\$\{created\.token\}/);
});

test('workspace admission and OAuth pairing remain local request actions', () => {
  assert.match(requests, /workspace:select/);
  assert.match(requests, /Workspace access/);
  assert.match(requests, /data-request-approve/);
  assert.match(requests, /data-request-deny/);
  assert.match(requests, /data-request-oauth-approve/);
  assert.match(requests, /data-request-oauth-deny/);
  assert.match(requests, /pairingCode/);
  assert.match(requests, /clientName/);
  assert.match(requests, /\/api\/oauth\/requests\/\$\{oauthApprove\}\/approve/);
});

test('header renders compact Core Worker MCP and Tunnel health chips without repeated running labels', () => {
  for (const name of ['Core', 'Worker', 'MCP', 'Tunnel']) {
    assert.match(main, new RegExp(`['"]${name}['"]`));
  }
  assert.match(main, /health-chip/);
  assert.match(main, /data-health/);
  assert.doesNotMatch(main, />Core \$\{/);
  assert.doesNotMatch(main, />Worker \$\{/);
});

test('Connect an AI is parallel example guidance and not a pairing queue', () => {
  assert.match(dashboard, /Examples only/i);
  for (const provider of ['ChatGPT', 'Claude', 'Gemini']) {
    assert.match(dashboard, new RegExp(provider));
  }
  assert.match(dashboard, /client-grid/);
  assert.doesNotMatch(dashboard, />Pairing requests</i);
});

test('rendered timestamps use the browser device locale and timezone', () => {
  assert.match(time, /toLocaleString\s*\(/);
  for (const page of [
    'apps/web/pages/sessions.js',
    'apps/web/pages/audit.js',
    'apps/web/pages/processes.js',
  ]) {
    assert.match(readFileSync(page, 'utf8'), /localDateTime\(/);
  }
});

test('Guide page loads the API manifest and shipped local manual chapters', () => {
  assert.match(guide, /\/api\/guide/);
  assert.match(guide, /\/manual\/\$\{chapter\.file\}/);
});

test('user manual follows onboarding and is copied into the shipped web app', () => {
  const chapters = [
    '00-quick-start.md',
    '01-install.md',
    '02-first-start.md',
    '03-remote-access.md',
    '04-connect-chatgpt.md',
    '05-connect-claude.md',
    '06-connect-gemini.md',
    '07-workspaces.md',
    '08-permissions-approvals.md',
    '09-skills.md',
    '10-changes-recovery.md',
    '11-processes.md',
    '12-service.md',
    '13-security-authentication.md',
    '14-troubleshooting.md',
    '15-explore.md',
  ];
  const copy = readFileSync('scripts/copy-static.mjs', 'utf8');
  assert.match(copy, /docs\/user-manual/);
  assert.match(copy, /dist\/apps\/web\/manual/);
  for (const file of chapters) {
    assert.doesNotThrow(
      () => readFileSync(`docs/user-manual/${file}`, 'utf8'),
      file,
    );
  }
  const chatgpt = readFileSync(
    'docs/user-manual/04-connect-chatgpt.md',
    'utf8',
  );
  assert.match(chatgpt, /https:\/\/<your-hostname>\/mcp/);
  assert.match(chatgpt, /OAuth/i);
  assert.doesNotMatch(chatgpt, /\/mcp\/<token>|\/mcp\/<connector-token>/i);
  const security = readFileSync(
    'docs/user-manual/13-security-authentication.md',
    'utf8',
  );
  assert.match(security, /PKCE/i);
  assert.match(security, /local approval/i);
  assert.match(security, /Bearer/i);
});

test('README presents OAuth /mcp as recommended and URL tokens as legacy only', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /Getting Started/);
  assert.match(readme, /https:\/\/<host>\/mcp/);
  assert.match(readme, /Authorization Code.*PKCE/is);
  assert.match(readme, /local approval/i);
  assert.match(readme, /Authorization: Bearer <token>/);
  const connect = readme.slice(
    readme.indexOf('## Connect an AI web interface'),
    readme.indexOf('## MCP tools'),
  );
  assert.match(connect, /ChatGPT.*OAuth/is);
  assert.doesNotMatch(
    connect,
    /copy the one-time URL|No authentication|mcp\/<connector-token>/i,
  );
});
