import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, input } from './mcp-upstream-registry-service.fixture.js';
const connectsOf = (calls: string[]) => calls.filter((call) => call.startsWith('connect:'));

test('editing connection fields of a disabled server does not connect', async () => {
  const { db, service, calls } = harness();
  try {
    const record = await service.register(input);
    await service.setEnabled(record.id, false);
    const connects = connectsOf(calls).length;
    const updated = await service.update(record.id, {
      config: { url: 'https://new.example.com/mcp' },
    });
    assert.deepEqual(updated.config, { url: 'https://new.example.com/mcp' });
    assert.equal(updated.enabled, false);
    assert.equal(updated.catalogFingerprint, record.catalogFingerprint);
    assert.equal(connectsOf(calls).length, connects);
    assert.deepEqual(service.serving(), []);
  } finally {
    db.close();
  }
});
