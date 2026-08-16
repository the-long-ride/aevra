import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandSecretStore, SpawnAdapter } from '../src/platform.js';

test('platform adapter probe is injectable and does not touch real stores', async () => {
  const calls: any[] = [];
  const adapter = {
    async run(file: string, args: string[]) {
      calls.push([file, args]);
      return { code: 0, stdout: 'ok' };
    },
  };
  const s = new CommandSecretStore('linux', adapter);
  assert.equal(await s.probe(), true);
  assert.equal(calls[0][0], 'secret-tool');

  const darwin = new CommandSecretStore('darwin', adapter);
  assert.equal(await darwin.probe(), true);
  assert.equal(calls.at(-1)![0], 'security');

  const win = new CommandSecretStore('win32', adapter);
  assert.equal(await win.probe(), true);
  assert.equal(calls.at(-1)![0], 'powershell.exe');

  const unsupported = new CommandSecretStore('aix' as any, adapter);
  assert.equal(await unsupported.probe(), false);

  const failingAdapter = {
    async run() {
      throw new Error('boom');
    },
  };
  const failingStore = new CommandSecretStore('linux', failingAdapter);
  assert.equal(await failingStore.probe(), false);
});

test('CommandSecretStore set get delete on darwin linux and win32', async () => {
  const calls: any[] = [];
  const adapter = {
    async run(file: string, args: string[], input?: string) {
      calls.push([file, args, input]);
      return { code: 0, stdout: 'secret-val\n' };
    },
  };

  // Darwin
  const darwin = new CommandSecretStore('darwin', adapter);
  await darwin.set('k1', 'v1');
  assert.equal(calls.at(-1)![0], 'security');
  assert.equal(await darwin.get('k1'), 'secret-val');
  await darwin.delete('k1');

  // Linux
  const linux = new CommandSecretStore('linux', adapter);
  await linux.set('k2', 'v2');
  assert.equal(calls.at(-1)![0], 'secret-tool');
  assert.equal(await linux.get('k2'), 'secret-val');
  await linux.delete('k2');

  // Win32
  const win = new CommandSecretStore('win32', adapter);
  await win.set('k3', 'v3');
  assert.equal(calls.at(-1)![0], 'powershell.exe');
  assert.equal(await win.get('k3'), null);
  await win.delete('k3');

  // Unsupported platform
  const unsupported = new CommandSecretStore('sunos' as any, adapter);
  await assert.rejects(() => unsupported.set('k4', 'v4'), /unsupported platform/);
  assert.equal(await unsupported.get('k4'), null);

  // Errors on set
  const errorAdapter = {
    async run() {
      return { code: 1, stdout: '' };
    },
  };
  await assert.rejects(
    () => new CommandSecretStore('darwin', errorAdapter).set('k', 'v'),
    /Keychain store failed/,
  );
  await assert.rejects(
    () => new CommandSecretStore('linux', errorAdapter).set('k', 'v'),
    /Secret Service store failed/,
  );
  await assert.rejects(
    () => new CommandSecretStore('win32', errorAdapter).set('k', 'v'),
    /Credential Manager store failed/,
  );
  assert.equal(await new CommandSecretStore('darwin', errorAdapter).get('k'), null);
  assert.equal(await new CommandSecretStore('linux', errorAdapter).get('k'), null);
});

test('SpawnAdapter instantiation', () => {
  const adapter = new SpawnAdapter();
  assert.ok(adapter);
});
