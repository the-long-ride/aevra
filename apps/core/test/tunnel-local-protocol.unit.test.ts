import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { CloudflareManagerImpl } from '../src/cloudflare/manager.js';
import { NgrokAdapter } from '../src/exposure/ngrok.js';

function childDouble() {
  const child = new EventEmitter() as EventEmitter & {
    killed: boolean;
    kill(signal?: string): boolean;
  };
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

test('managed Cloudflare accepts HTTP only for a loopback gateway origin', async () => {
  const db = AevraDatabase.open(':memory:');
  const settings = new SettingsRepository(db.raw());
  settings.set('cloudflare.config', {
    tunnelId: '11111111-1111-1111-1111-111111111111',
    hostname: 'mcp.example.com',
  });
  const child = childDouble();
  const origins: string[] = [];
  const manager = new CloudflareManagerImpl(settings, {
    spawnTunnel(_id: string, origin: string) {
      origins.push(origin);
      return child;
    },
  } as any);

  await manager.start('http://127.0.0.1:47830');
  assert.deepEqual(origins, ['http://127.0.0.1:47830']);
  await manager.stop();

  await assert.rejects(() => manager.start('http://192.0.2.1:47830'), /loopback HTTP or HTTPS/i);
  db.close();
});

test('managed ngrok accepts an HTTP loopback gateway while keeping the public URL HTTPS', async () => {
  const child = childDouble();
  const calls: string[][] = [];
  const adapter = new NgrokAdapter({
    spawn(_executable, args) {
      calls.push([...args]);
      return child as any;
    },
    async fetchJson() {
      return { tunnels: [{ public_url: 'https://secure.example.ngrok.app' }] };
    },
    async sleep() {},
  });

  assert.deepEqual(await adapter.start('http://127.0.0.1:47830'), {
    publicUrl: 'https://secure.example.ngrok.app',
  });
  assert.deepEqual(calls[0], [
    'http',
    'http://127.0.0.1:47830',
    '--log=stdout',
    '--log-format=json',
  ]);
  await adapter.stop();
});
