import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { BrowserPairingService } from '../src/browser/pairing-service.js';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const profileId = '11111111-1111-4111-8111-111111111111';

test('saved pairing is replayed on a fresh worker and worker failures remain visible', async () => {
  const store = new Map<string, unknown>();
  const sent: any[] = [];
  let available = false;
  const settings: any = {
    get: (key: string, fallback: unknown) => store.get(key) ?? fallback,
    set: (key: string, value: unknown) => void store.set(key, value),
  };
  const worker: any = {
    execute: async (input: any) => {
      sent.push(input);
      if (!available) throw Object.assign(new Error('offline'), { code: 'WORKER_UNAVAILABLE' });
      return {
        ok: true,
        value: {
          connected: false,
          transport: null,
          tabs: [],
          epoch: input.operation.epoch,
          listener: {
            state: 'listening',
            port: 47833,
            errorCode: null,
            changedAt: new Date().toISOString(),
          },
          extensionSocketAuthenticated: false,
          workerExtensionId: input.operation.extensionId,
          workerEpoch: input.operation.epoch,
        },
      };
    },
  };
  const secret = randomBytes(32);
  const first = new BrowserPairingService(settings, worker, () => secret);
  await first.redeem({
    code: first.createCode().code,
    extensionId,
    profileId,
    profileName: 'TLR',
  });
  const restarted = new BrowserPairingService(settings, worker, () => secret);
  const failed = await restarted.pairingHealth();
  assert.equal(failed.coreExtensionId, extensionId);
  assert.equal(failed.worker, null);
  assert.equal(failed.syncErrorCode, 'WORKER_UNAVAILABLE');
  available = true;
  const ready = await restarted.pairingHealth();
  assert.equal(ready.worker?.workerExtensionId, extensionId);
  assert.equal(ready.worker?.workerEpoch, first.epoch());
  assert.equal(ready.syncErrorCode, null);
  assert.equal(sent.at(-1).operation.extensionId, extensionId);
});
