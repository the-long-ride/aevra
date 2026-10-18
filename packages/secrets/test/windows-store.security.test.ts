import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandSecretStore } from '../src/platform.js';

test('Windows storage round trips a plain phrase over stdin and deletes the same target', async () => {
  const values = new Map<string, string>();
  const calls: Array<{ args: string[]; input?: string }> = [];
  const adapter = {
    async run(_file: string, args: string[], input?: string) {
      calls.push({ args, input });
      if (!input) return { code: 0, stdout: '' };
      const request = JSON.parse(input);
      const target = `${request.service}:${request.ref}`;
      if (request.operation === 'set') values.set(target, request.value);
      if (request.operation === 'delete') values.delete(target);
      return {
        code: 0,
        stdout: request.operation === 'get' ? JSON.stringify(values.get(target) ?? null) : '',
      };
    },
  };
  const store = new CommandSecretStore('win32', adapter);
  await store.set('sample reference', 'ordinary private words');
  assert.equal(await store.get('sample reference'), 'ordinary private words');
  await store.delete('sample reference');
  assert.equal(await store.get('sample reference'), null);
  assert.ok(calls.every((call) => !call.args.join(' ').includes('ordinary private words')));
  assert.equal(values.size, 0);
});

test(
  'native Windows credential set/get/delete round trip',
  { skip: process.platform !== 'win32' },
  async () => {
    const store = new CommandSecretStore('win32', undefined, `AevraRegression-${process.pid}`);
    const ref = 'ordinary regression reference';
    try {
      await store.set(ref, 'ordinary private words');
      assert.equal(await store.get(ref), 'ordinary private words');
      await store.delete(ref);
      assert.equal(await store.get(ref), null);
    } finally {
      await store.delete(ref);
    }
  },
);
