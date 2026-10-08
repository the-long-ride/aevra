import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminApi,
  createAuthenticatedUiUrl,
  revokeAllAdminSessions,
} from '../src/admin-session.js';
import { runBackupCommand } from '../src/commands/backup-command.js';
import {
  cloudflareSetupNeedsAccess,
  completionText,
  formatCliError,
  readyLines,
  usageText,
} from '../src/cli-support.js';

const plainPhrase1 = 'sample words';

function login(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status < 400,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

function deps(loginResponse: ReturnType<typeof login>, after?: ReturnType<typeof login>) {
  const calls: Array<{ path: string; init?: any }> = [];
  return {
    calls,
    value: {
      controlSecret: async () => 'control words',
      credentials: async () => ({ username: 'sample', password: plainPhrase1 }),
      base: () => 'http://127.0.0.1:9/',
      fetch: async (_config: object, path: string, init?: any) => {
        calls.push({ path, init });
        return path === '/api/auth/login' ? loginResponse : (after ?? login(200, {}));
      },
    },
  };
}

async function loginError(response: ReturnType<typeof login>) {
  try {
    await adminApi({}, '/api/x', undefined, deps(response).value);
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error('expected login failure');
}

test('admin login failures carry the most specific detail available', async () => {
  assert.equal(
    (await loginError(login(401, { error: 'bad user' }))).message,
    'Admin login failed (401): bad user',
  );
  assert.equal(
    (await loginError(login(403, { error: { message: 'locked' } }))).message,
    'Admin login failed (403): locked',
  );
  assert.equal(
    (await loginError(login(500, { error: { other: 1 } }))).message,
    'Admin login failed (500)',
  );
  const broken = await loginError(login(502, new Error('not json')));
  assert.deepEqual(
    [broken.message, broken.code],
    ['Admin login failed (502)', 'ADMIN_LOGIN_FAILED'],
  );
  const limited = await loginError(login(429, {}, { 'retry-after': '30' }));
  assert.deepEqual(
    [limited.message, limited.code],
    ['Admin login rate limited; retry in 30s', 'ADMIN_LOGIN_RATE_LIMITED'],
  );
  assert.equal((await loginError(login(429, {}))).message, 'Admin login rate limited');
  assert.equal(
    (await loginError(login(200, {}))).message,
    'Core did not issue an admin session cookie',
  );
});

test('adminApi forwards the session cookie with and without caller headers', async () => {
  const ok = login(200, {}, { 'set-cookie': 'aevra_admin=abc; HttpOnly' });
  let d = deps(ok);
  await adminApi({}, '/api/y', { method: 'POST', headers: { accept: 'x' } }, d.value);
  assert.deepEqual(d.calls[1]!.init, {
    method: 'POST',
    headers: { accept: 'x', cookie: 'aevra_admin=abc' },
  });
  d = deps(ok);
  await adminApi({}, '/api/y', undefined, d.value);
  assert.deepEqual(d.calls[1]!.init.headers, { cookie: 'aevra_admin=abc' });
  assert.equal(d.calls[0]!.init.headers.origin, 'http://127.0.0.1:9/');
});

test('ui url trims the base and revoke-all reports status or failure', async () => {
  assert.equal(
    await createAuthenticatedUiUrl({}, deps(login(200, {})).value),
    'http://127.0.0.1:9/',
  );
  const d = deps(login(200, {}), login(204, {}));
  assert.equal(await revokeAllAdminSessions({}, d.value), 204);
  assert.equal(d.calls[0]!.init.headers['x-aevra-control'], 'control words');
  await assert.rejects(
    () => revokeAllAdminSessions({}, deps(login(200, {}), login(503, {})).value),
    /Core returned 503/,
  );
});

function backupDeps(overrides: Record<string, unknown> = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    value: {
      inspect: (file: string) => ({
        file,
        integrityOk: false,
        integrityMessage: 'page 3',
        sizeBytes: 10,
        counts: { workspaces: 2 },
      }),
      restore: () => ({ databasePath: 'db.sqlite', previousBackedUpTo: null }),
      health: async () => ({ ok: false }),
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ...overrides,
    } as any,
  };
}

test('backup verify reports broken integrity and missing table counts', async () => {
  const d = backupDeps();
  assert.equal(
    await runBackupCommand(
      { stateDir: 's' },
      { command: 'backup', action: 'verify', file: 'b.db' } as any,
      d.value,
    ),
    1,
  );
  assert.deepEqual(d.logs, [
    'file: b.db',
    'integrity: BROKEN — page 3',
    'size: 10 bytes',
    'workspaces: 2',
    'connectors: 0',
    'sessions: 0',
    'audit_events: 0',
  ]);
});

test('backup restore tolerates an unreachable daemon but refuses a running one', async () => {
  const restore = { command: 'backup', action: 'restore', file: 'b.db', yes: true } as any;
  let d = backupDeps({
    health: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal(await runBackupCommand({ stateDir: 's' }, restore, d.value), 0);
  assert.deepEqual(d.logs, ['[aevra] Restored db.sqlite']);
  d = backupDeps({ health: async () => ({ ok: true }) });
  assert.equal(await runBackupCommand({ stateDir: 's' }, restore, d.value), 1);
  assert.equal(d.errors[0], '[aevra] backup failed: daemon is running — stop it before restoring');
  d = backupDeps({
    restore: () => {
      throw new Error('locked file');
    },
  });
  assert.equal(await runBackupCommand({ stateDir: 's' }, restore, d.value), 1);
  assert.equal(d.errors[0], '[aevra] backup failed: locked file');
});

test('cli support text helpers cover every shell and error shape', () => {
  assert.match(usageText(), /aevra backup verify/);
  assert.equal(formatCliError('text'), 'text');
  assert.equal(formatCliError(new Error('plain')), 'plain');
  const credentials = formatCliError(
    Object.assign(new Error('missing'), { code: 'ADMIN_CREDENTIALS_REQUIRED' }),
  );
  assert.match(credentials, /^missing\nSet both AEVRA_USERNAME/);
  assert.ok(
    readyLines({ adminUrl: 'a', mcpUrl: 'm', gatewayUrl: 'g', desktopHelperReady: true }).some(
      (line) => line.includes('Gateway'),
    ),
  );
  assert.equal(
    readyLines({ adminUrl: 'a', mcpUrl: 'm', desktopHelperReady: false }).some((line) =>
      line.includes('Gateway'),
    ),
    false,
  );
  assert.match(completionText('bash'), /complete -F _aevra aevra/);
  assert.match(completionText('zsh'), /#compdef aevra/);
  assert.match(completionText('powershell'), /Register-ArgumentCompleter/);
  assert.equal(cloudflareSetupNeedsAccess(' ACCESS '), true);
  assert.equal(cloudflareSetupNeedsAccess('token'), false);
});
