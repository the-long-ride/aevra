import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { CloudflareManagerImpl } from '../src/cloudflare/manager.js';

test('managed Cloudflare exposure targets the supplied public gateway origin', async () => {
  const db = AevraDatabase.open(':memory:');
  const settings = new SettingsRepository(db.raw());
  settings.set('cloudflare.config', {
    tunnelId: '11111111-1111-1111-1111-111111111111',
    hostname: 'mcp.example.com',
  });
  let call: [string, string] | undefined;
  const child: any = {
    once() {},
    killed: false,
    kill() {
      this.killed = true;
    },
  };
  const manager = new CloudflareManagerImpl(
    settings,
    {
      spawnTunnel(id: string, origin: string) {
        call = [id, origin];
        return child;
      },
    } as any,
    'https://localhost:47832',
  );

  assert.deepEqual(await manager.start('https://localhost:47830'), {
    publicUrl: 'https://mcp.example.com',
  });
  assert.deepEqual(call, ['11111111-1111-1111-1111-111111111111', 'https://localhost:47830']);
  await manager.stop();
  db.close();
});
