import assert from 'node:assert/strict';
import test from 'node:test';
import { CloudflaredCli } from '../src/cloudflare/cloudflared.js';

test('cloudflared managed origin uses HTTPS with local certificate verification disabled only for loopback origin', () => {
  let call: any;
  const runner: any = {
    spawn(file: string, args: string[]) {
      call = [file, args];
      return {};
    },
    async run() {
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  new CloudflaredCli(runner).spawnTunnel('tid', 'https://localhost:47832');
  assert.deepEqual(call, [
    'cloudflared',
    [
      'tunnel',
      '--no-autoupdate',
      'run',
      '--url',
      'https://localhost:47832',
      '--no-tls-verify',
      'tid',
    ],
  ]);
});
