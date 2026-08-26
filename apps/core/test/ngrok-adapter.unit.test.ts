import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { NgrokAdapter } from '../src/exposure/ngrok.js';

function childProcessDouble() {
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

test('managed ngrok uses an argument array and discovers the HTTPS forwarding URL', async () => {
  const child = childProcessDouble();
  const calls: Array<{ executable: string; args: string[]; shell: boolean | undefined }> = [];
  const adapter = new NgrokAdapter({
    spawn(executable, args, options) {
      calls.push({ executable, args: [...args], shell: options.shell });
      return child as any;
    },
    async fetchJson() {
      return {
        tunnels: [
          { public_url: 'http://insecure.example.ngrok.app' },
          { public_url: 'https://secure.example.ngrok.app' },
        ],
      };
    },
    async sleep() {},
  });

  assert.deepEqual(await adapter.start('https://localhost:47830'), {
    publicUrl: 'https://secure.example.ngrok.app',
  });
  assert.deepEqual(calls, [
    {
      executable: 'ngrok',
      args: ['http', 'https://localhost:47830', '--log=stdout', '--log-format=json'],
      shell: false,
    },
  ]);

  await adapter.stop();
  assert.equal(child.killed, true);
});

test('managed ngrok surfaces executable startup errors instead of inventing a public URL', async () => {
  const child = childProcessDouble();
  const adapter = new NgrokAdapter({
    spawn() {
      queueMicrotask(() => child.emit('error', new Error('spawn ngrok ENOENT')));
      return child as any;
    },
    async fetchJson() {
      return { tunnels: [] };
    },
    async sleep() {},
  });

  await assert.rejects(() => adapter.start('https://localhost:47830'), /ENOENT/);
  assert.equal((await adapter.status()).state, 'error');
});

test('managed ngrok stable domain uses --url and requires discovery to match', async () => {
  const child = childProcessDouble();
  const calls: Array<{ executable: string; args: string[] }> = [];
  const adapter = new NgrokAdapter({
    spawn(executable, args) {
      calls.push({ executable, args: [...args] });
      return child as any;
    },
    async fetchJson() {
      return { tunnels: [{ public_url: 'https://stable.example.ngrok.app' }] };
    },
    async sleep() {},
  });

  assert.deepEqual(
    await adapter.start('https://localhost:47830', 'https://stable.example.ngrok.app'),
    { publicUrl: 'https://stable.example.ngrok.app' },
  );
  assert.deepEqual(calls[0]?.args, [
    'http',
    'https://localhost:47830',
    '--url',
    'https://stable.example.ngrok.app',
    '--log=stdout',
    '--log-format=json',
  ]);
});

test('managed ngrok stable domain rejects a discovered URL mismatch', async () => {
  const child = childProcessDouble();
  const adapter = new NgrokAdapter({
    spawn() {
      return child as any;
    },
    async fetchJson() {
      return { tunnels: [{ public_url: 'https://other.example.ngrok.app' }] };
    },
    async sleep() {},
  });

  await assert.rejects(
    () => adapter.start('https://localhost:47830', 'https://stable.example.ngrok.app'),
    /stable URL mismatch/i,
  );
  assert.equal(child.killed, true);
});
