import assert from 'node:assert/strict';
import test from 'node:test';
import type { CdpClient } from '../src/cdp-client.js';
import { cdpBoxForBackend, clearFocusedCdpField, resolveCdpSelector } from '../src/cdp-selector.js';

function fakeClient(respond: (method: string, params: Record<string, unknown>) => unknown): {
  client: CdpClient;
  calls: Array<[string, Record<string, unknown>]>;
} {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    client: {
      send: async (method: string, params: Record<string, unknown> = {}) => {
        calls.push([method, params]);
        return respond(method, params);
      },
    } as unknown as CdpClient,
  };
}

test('resolves a CSS selector to a backend node without evaluating page script', async () => {
  const { client, calls } = fakeClient((method) => {
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelector') return { nodeId: 7 };
    if (method === 'DOM.describeNode') {
      return { node: { backendNodeId: 42, attributes: ['type', 'text', 'id', 'q'] } };
    }
    return {};
  });

  assert.deepEqual(await resolveCdpSelector(client, '#q'), {
    backendNodeId: 42,
    credential: false,
  });
  assert.deepEqual(
    calls.map(([method]) => method),
    ['DOM.getDocument', 'DOM.querySelector', 'DOM.describeNode'],
  );
  assert.equal(
    calls.some(([method]) => method === 'Runtime.evaluate'),
    false,
  );
});

test('selector resolution marks password-shaped targets as credentials', async () => {
  const { client } = fakeClient((method) => {
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelector') return { nodeId: 2 };
    return { node: { backendNodeId: 9, attributes: ['type', 'password'] } };
  });
  assert.equal((await resolveCdpSelector(client, '#password')).credential, true);
});

test('selector resolution reports missing and invalid selectors distinctly', async () => {
  const missing = fakeClient((method) => {
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelector') return { nodeId: 0 };
    return {};
  }).client;
  await assert.rejects(() => resolveCdpSelector(missing, '.missing'), /NOT_FOUND/);

  const invalid = fakeClient((method) => {
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelector') throw new Error('not a valid selector');
    return {};
  }).client;
  await assert.rejects(() => resolveCdpSelector(invalid, '['), /INVALID_REQUEST/);
});

test('box and clear helpers use bounded CDP input primitives', async () => {
  const { client, calls } = fakeClient((method) =>
    method === 'DOM.getBoxModel'
      ? { model: { content: [10, 20, 30, 20, 30, 50, 10, 50], width: 20, height: 30 } }
      : {},
  );
  assert.deepEqual(await cdpBoxForBackend(client, 42), { x: 10, y: 20, width: 20, height: 30 });
  await clearFocusedCdpField(client);
  assert.equal(calls.filter(([method]) => method === 'Input.dispatchKeyEvent').length, 4);
});
