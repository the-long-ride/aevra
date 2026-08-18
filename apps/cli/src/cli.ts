#!/usr/bin/env node
import { readFileSync, realpathSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { parseAevraArgs } from './args.js';
import { formatCliError, cloudflareSetupNeedsAccess, readyLines, usageText, completionText } from './cli-support.js';
import { localAdminBase, localAdminFetch } from './local-client.js';
import { loadCoreConfig } from '../../core/src/config.js';
import { createCoreRuntime } from '../../core/src/runtime.js';
import { runStart } from './run.js';
import { createUserServiceAdapter } from '../../core/src/service/service-manager.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { CloudflareManagerImpl } from '../../core/src/cloudflare/manager.js';

function openBrowser(url: string) {
  const [cmd, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

async function localControl(config = loadCoreConfig()) {
  return readFileSync(path.join(config.stateDir, 'local-control.secret'), 'utf8').trim();
}

async function adminApi(config: ReturnType<typeof loadCoreConfig>, apiPath: string, init?: RequestInit) {
  const secret = await localControl(config);
  const boot = await localAdminFetch(config, '/api/local/bootstrap', { method: 'POST', headers: { 'x-aevra-control': secret } });
  if (!boot.ok) throw new Error(`Core returned ${boot.status}`);
  const { token } = await boot.json() as any;
  const auth = await localAdminFetch(config, `/auth/bootstrap?token=${encodeURIComponent(token)}`);
  const cookie = (auth.headers.get('set-cookie') ?? '').split(';')[0]!;
  return localAdminFetch(config, apiPath, { ...init, headers: { ...init?.headers, cookie } });
}

async function openAuthenticatedUi(config: ReturnType<typeof loadCoreConfig>, logoutAll = false): Promise<void> {
  const secret = await localControl(config);
  const endpoint = logoutAll ? '/api/local/logout-all' : '/api/local/bootstrap';
  const response = await localAdminFetch(config, endpoint, { method: 'POST', headers: { 'x-aevra-control': secret } });
  if (!response.ok) throw new Error(`Core returned ${response.status}`);
  if (logoutAll) {
    console.error('[aevra] Revoked all local admin sessions.');
    return;
  }
  const { token } = await response.json() as any;
  const url = `${localAdminBase(config)}/auth/bootstrap?token=${encodeURIComponent(token)}`;
  openBrowser(url);
  console.error(`[aevra] Opening ${url}`);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let cmd;
  try {
    cmd = parseAevraArgs(argv);
  } catch (error) {
    console.error(`[aevra] ${formatCliError(error)}\n\n${usageText()}`);
    return 1;
  }
  if (cmd.command === 'help') {
    console.log(usageText());
    return 0;
  }

  const config = loadCoreConfig();
  if (cmd.command === 'start') {
    return runStart(config, {
      signals: process,
      createRuntime: createCoreRuntime,
      async onReady(info) {
        for (const line of readyLines(info)) console.error(line);
        if (cmd.ui) {
          try { await openAuthenticatedUi(config); }
          catch (error) { console.error(`[aevra] UI launch failed: ${formatCliError(error)}`); }
        }
      },
    });
  }
  if (cmd.command === 'ui') {
    try {
      await openAuthenticatedUi(config, cmd.logoutAll);
      return 0;
    } catch (error) {
      console.error(`[aevra] ${formatCliError(error)}. Is aevra start/service running?`);
      return 1;
    }
  }
  if (cmd.command === 'setup') {
    if (!process.stdin.isTTY) {
      console.error('[aevra] setup requires an interactive terminal; alternatively use Aevra UI → Settings → Cloudflare.');
      return 1;
    }
    mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
    const db = AevraDatabase.open(config.databasePath);
    const settings = new SettingsRepository(db.raw());
    const manager = new CloudflareManagerImpl(settings, undefined, `https://localhost:${config.mcpPort}`);
    const rl = createInterface({ input, output });
    try {
      const detected = await manager.detectCloudflared();
      if (!detected.found) {
        console.error('[aevra] cloudflared was not found on PATH.');
        return 1;
      }
      console.error(`[aevra] cloudflared: ${detected.version ?? 'detected'}`);
      const login = (await rl.question('Authenticate/select Cloudflare account now? [Y/n] ')).trim().toLowerCase();
      if (login !== 'n' && login !== 'no') {
        const result = await manager.authenticate();
        if (result.code !== 0) throw new Error(`cloudflared login failed: ${result.stderr}`);
      }
      const hostname = (await rl.question('Public MCP hostname (for example mcp.example.com): ')).trim();
      const tunnelId = (await rl.question('Existing tunnel ID (leave empty to create Aevra tunnel): ')).trim();
      const authAnswer=(await rl.question('Remote MCP authentication [connector/access] (connector): ')).trim().toLowerCase();
      const authMode=cloudflareSetupNeedsAccess(authAnswer)?'access':'connector';
      let issuer='',audience='';
      if(authMode==='access'){
        console.error('[aevra] Create/select a Cloudflare Access application for /mcp, then enter its verifier values.');
        issuer=(await rl.question('Cloudflare Access issuer URL: ')).trim();
        audience=(await rl.question('Cloudflare Access audience: ')).trim();
      }else console.error('[aevra] Connector-token mode selected: plain /mcp stays closed; use /mcp/<token> URLs created by aevra connectors create.');
      const ownership = (await rl.question('Tunnel ownership [managed/external] (managed): ')).trim().toLowerCase() === 'external' ? 'external' : 'managed';
      const result = await manager.setup({ hostname, tunnelId: tunnelId || undefined, authMode, ownership, issuer:issuer||undefined, audience:audience||undefined });
      console.error(`[aevra] Configured https://${result.hostname}/mcp (${ownership} tunnel ownership, ${authMode} authentication).`);
      if(authMode==='connector')console.error('[aevra] Next: aevra connectors create ChatGPT');
      return 0;
    } catch (error) {
      console.error(`[aevra] setup failed: ${formatCliError(error)}`);
      return 1;
    } finally {
      rl.close();
      db.close();
    }
  }
  if (cmd.command === 'status') {
    try {
      const response = await localAdminFetch(config, '/api/health');
      if (!response.ok) throw new Error(`Core returned ${response.status}`);
      const status = await response.json() as any;
      if (cmd.json) console.log(JSON.stringify(status, null, 2));
      else for (const [key, value] of Object.entries(status)) console.log(`${key}: ${value}`);
      return 0;
    } catch (error) {
      if (cmd.json) console.log(JSON.stringify({ core: 'unreachable', error: formatCliError(error) }));
      else console.error(`[aevra] status failed: ${formatCliError(error)}. Is aevra start/service running?`);
      return 1;
    }
  }
  if (cmd.command === 'completion') {
    process.stdout.write(completionText(cmd.shell));
    return 0;
  }
  if (cmd.command === 'backup') {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      if (cmd.action === 'verify') {
        const { inspectBackup } = await import('../../core/src/backup/verify.js');
        const inspection = inspectBackup(cmd.file, (file) => { const db = new DatabaseSync(file); db.exec('PRAGMA busy_timeout=5000;'); return db; });
        console.log(`file: ${inspection.file}`);
        console.log(`integrity: ${inspection.integrityOk ? 'ok' : `BROKEN — ${inspection.integrityMessage}`}`);
        console.log(`size: ${inspection.sizeBytes} bytes`);
        for (const table of ['workspaces', 'connectors', 'sessions', 'audit_events']) console.log(`${table}: ${inspection.counts[table] ?? 0}`);
        return inspection.integrityOk ? 0 : 1;
      }
      if (!cmd.yes) {
        console.error(`[aevra] restore overwrites ${config.stateDir} — re-run with --yes to confirm. The current database is kept as a .pre-restore copy.`);
        return 1;
      }
      try {
        const health = await localAdminFetch(config, '/api/health');
        if (health.ok) throw new Error('daemon is running — stop it before restoring');
      } catch (error) {
        if ((error as any).message?.includes('daemon is running')) throw error;
      }
      const { restoreBackup } = await import('../../core/src/backup/verify.js');
      const result = restoreBackup(cmd.file, config.stateDir);
      console.log(`[aevra] Restored ${result.databasePath}${result.previousBackedUpTo ? ` (previous kept at ${result.previousBackedUpTo})` : ''}`);
      return 0;
    } catch (error) {
      console.error(`[aevra] backup failed: ${formatCliError(error)}`);
      return 1;
    }
  }
  if (cmd.command === 'audit') {
    if (!cmd.yes) {
      console.error('[aevra] audit clear permanently removes audit event rows. Re-run with --yes to confirm.');
      return 1;
    }
    try {
      const response=await adminApi(config,'/api/audit',{method:'DELETE'});
      if(!response.ok)throw new Error(`Core returned ${response.status}`);
      const value=await response.json() as any;
      console.log(`[aevra] Cleared ${value.removed??0} audit event(s).`);
      return 0;
    }catch(error){
      console.error(`[aevra] audit clear failed: ${formatCliError(error)}. Is aevra start/service running?`);
      return 1;
    }
  }
  if (cmd.command === 'sessions') {
    if (!cmd.yes) {
      console.error('[aevra] revoke-others removes non-connector MCP sessions and other admin sessions. Re-run with --yes to confirm.');
      return 1;
    }
    try {
      const response=await adminApi(config,'/api/sessions/revoke-others',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      if(!response.ok)throw new Error(`Core returned ${response.status}`);
      const value=await response.json() as any;
      console.log(`[aevra] Revoked ${value.revokedRemote??0} remote and ${value.revokedAdmin??0} admin session(s); preserved ${value.preservedConnectors??0} connector and ${value.preservedAdmin??0} current admin session(s).`);
      return 0;
    }catch(error){
      console.error(`[aevra] sessions revoke-others failed: ${formatCliError(error)}. Is aevra start/service running?`);
      return 1;
    }
  }
  if (cmd.command === 'connectors') {
    try {
      if (cmd.action === 'list') {
        const response = await adminApi(config, '/api/connectors');
        const items = await response.json() as any[];
        if (!items.length) console.log('No connectors.');
        for (const connector of items) console.log(`${connector.id}  ${connector.name}  created ${connector.createdAt}${connector.lastUsedAt ? `  last used ${connector.lastUsedAt}` : ''}`);
        return 0;
      }
      if (cmd.action === 'create') {
        const response = await adminApi(config, '/api/connectors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: cmd.name }) });
        if (!response.ok) throw new Error(String((await response.json() as any).error?.message ?? response.status));
        const created = await response.json() as any;
        let host = '';
        try {
          const cf = await adminApi(config, '/api/cloudflare/status');
          host = String((await cf.json() as any).hostname ?? '');
        } catch { /* Cloudflare status is optional for connector creation. */ }
        console.log(`[aevra] Connector created: ${created.name} (${created.id})`);
        console.log(host ? `[aevra] URL: https://${host}/mcp/${created.token}` : `[aevra] Token path: /mcp/${created.token} (configure a Cloudflare hostname for a full URL)`);
        console.log('[aevra] Copy it now — the token is shown only once.');
        return 0;
      }
      const response = await adminApi(config, `/api/connectors/${cmd.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Core returned ${response.status}`);
      console.log(`[aevra] Revoked ${cmd.id}`);
      return 0;
    } catch (error) {
      console.error(`[aevra] connectors failed: ${formatCliError(error)}. Is aevra start/service running?`);
      return 1;
    }
  }

  const service = createUserServiceAdapter(process.platform, process.execPath, process.argv[1]!);
  try {
    if (cmd.action === 'install') await service.install();
    else if (cmd.action === 'start') await service.start();
    else if (cmd.action === 'stop') await service.stop();
    else if (cmd.action === 'restart') await service.restart();
    else console.log(await service.status());
    return 0;
  } catch (error) {
    console.error(`[aevra] service ${cmd.action} failed: ${formatCliError(error)}`);
    return 1;
  }
}

function isDirectCliEntry(moduleUrl: string, entryPath: string | undefined) {
  if (!entryPath) return false;
  try { return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entryPath); }
  catch { return false; }
}

if (isDirectCliEntry(import.meta.url, process.argv[1])) void main().then((code) => { process.exitCode = code; });