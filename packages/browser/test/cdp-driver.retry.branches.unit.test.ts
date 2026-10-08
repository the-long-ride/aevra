import assert from 'node:assert/strict';
import test from 'node:test';
import { CdpDriver } from '../src/cdp-driver.js';
import { FakeCdp } from './fake-cdp.js';

test('snapshot retries only a transient CDP page attachment error', async () => {
  const fake = await FakeCdp.start([{ id: 'page-1' }]);
  const driver = new CdpDriver();
  try {
    await driver.connect({ transport: 'cdp', cdpPort: fake.port });
    let attempts = 0;
    fake.handlers['Accessibility.getFullAXTree'] = () => {
      attempts += 1;
      if (attempts <= 2) throw new Error('Not attached to an active page');
      return {
        nodes: [
          {
            nodeId: '1',
            role: { value: 'button' },
            name: { value: 'Ready' },
            backendDOMNodeId: 11,
          },
        ],
      };
    };
    const snapshot = await driver.snapshot({ mode: 'a11y', maxNodes: 10 });
    assert.equal(attempts, 3);
    assert.equal(snapshot.nodes?.[0]?.name, 'Ready');

    fake.handlers['Accessibility.getFullAXTree'] = () => {
      throw new Error('Unsupported accessibility operation');
    };
    await assert.rejects(
      driver.snapshot({ mode: 'a11y', maxNodes: 10 }),
      /Unsupported accessibility operation/,
    );
  } finally {
    await driver.disconnect();
    await fake.stop();
  }
});
