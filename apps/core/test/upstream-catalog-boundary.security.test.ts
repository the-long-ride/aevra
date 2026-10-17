import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, input, catalogWith } from './mcp-upstream-registry-service.fixture.js';
import { catalogFingerprint } from '../../../packages/mcp-upstream/src/fingerprint.js';

test('upstream forwarding rejects entries outside the acknowledged catalog', async () => {
  const fx = harness();
  try {
    await fx.service.register({ ...input, auth: {} });
    for (const call of [
      () => fx.service.callTool('github', 'unlisted', {}),
      () => fx.service.readResource('github', 'hidden://data'),
      () => fx.service.getPrompt('github', 'unlisted', {}),
    ]) {
      await assert.rejects(call, (error: any) =>
        ['MCP_UPSTREAM_ENTRY_NOT_REVIEWED', 'MCP_UPSTREAM_NEEDS_REVIEW'].includes(error.code),
      );
    }
    assert.equal(fx.forwarded(), 0);
  } finally {
    fx.db.close();
  }
});

test('acknowledge rejects a catalog swapped after the operator reviewed it', async () => {
  const fx = harness();
  try {
    const record = await fx.service.register({ ...input, auth: {} });
    const viewed = catalogWith('reviewed words');
    fx.setCatalog(viewed);
    await fx.service.refresh(record.id);
    fx.setCatalog(catalogWith('replacement words'));
    await fx.service.refresh(record.id);
    assert.throws(
      () => fx.service.acknowledge(record.id, catalogFingerprint(viewed)),
      (error: any) => error.code === 'MCP_UPSTREAM_CATALOG_CHANGED',
    );
    assert.equal(fx.service.get(record.id)?.state, 'needs-review');
  } finally {
    fx.db.close();
  }
});
