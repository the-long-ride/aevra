import assert from 'node:assert/strict';
import test from 'node:test';
import { CdpDriver } from '../src/cdp-driver.js';

for (const navigation of ['origin', 'same-url'])
  test(`CDP typing refuses ${navigation} navigation during focus`, async () => {
    let url = 'https://safe.test/';
    let version = 0;
    const inputs: string[] = [];
    const client = {
      get documentVersion() {
        return version;
      },
      async send(method: string) {
        if (method === 'Page.getNavigationHistory') return { currentIndex: 0, entries: [{ url }] };
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelector') return { nodeId: 2 };
        if (method === 'DOM.describeNode') return { node: { backendNodeId: 3, attributes: [] } };
        if (method === 'DOM.focus') {
          if (navigation === 'origin') url = 'https://blocked.test/';
          version++;
        }
        if (method.startsWith('Input.')) inputs.push(method);
        return {};
      },
    };
    const driver = new CdpDriver();
    (driver as any).sessions = {
      target: async () => ({
        id: 't',
        client,
        backendIds: [],
        credentialRefs: new Set(),
        version: 0,
        visionScale: 1,
      }),
    };
    const result = await driver.act(
      [{ op: 'type', selector: '#field', text: 'private input', clear: true }],
      { expectedUrl: 'https://safe.test/', stopOnError: true },
    );
    assert.equal(result[0]?.ok, false);
    assert.deepEqual(inputs, []);
  });
