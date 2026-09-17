import assert from 'node:assert/strict';
import test from 'node:test';
import type { UpstreamCatalog } from '../../mcp-upstream/src/protocol.js';
import {
  proxyPromptEntries,
  proxyResourceEntries,
  proxyToolDefinitions,
} from '../src/upstream-catalog.js';
import type { UpstreamRegistryService } from '../src/upstream-port.js';

function port(catalog: UpstreamCatalog): UpstreamRegistryService {
  const summary = {
    id: 'up_1',
    name: 'github',
    risk: 'MEDIUM' as const,
    enabled: true,
    state: 'active' as const,
  };
  return {
    list: () => [summary],
    findByName: (name) => (name === 'github' ? summary : null),
    catalogByName: (name) => (name === 'github' ? catalog : null),
    callTool: async () => ({}),
    readResource: async () => ({}),
    getPrompt: async () => ({}),
  };
}

test('tools are namespaced and their descriptions carry a provenance banner', () => {
  const [tool] = proxyToolDefinitions(
    port({
      tools: [{ name: 'search', description: 'Search issues' }],
      resources: [],
      prompts: [],
    }),
  );
  assert.equal(tool?.name, 'github__search');
  assert.match(tool!.description, /^\[Proxied from MCP server "github"\./);
  assert.match(tool!.description, /Search issues$/);
});

test('an upstream input schema is carried through but forced to an object type', () => {
  const [tool] = proxyToolDefinitions(
    port({
      tools: [
        {
          name: 'search',
          inputSchema: { type: 'array', properties: { q: { type: 'string' } } },
        },
      ],
      resources: [],
      prompts: [],
    }),
  );
  assert.equal(tool!.inputSchema.type, 'object');
  assert.deepEqual(tool!.inputSchema.properties, { q: { type: 'string' } });
});

test('a missing or non-object input schema becomes a bare object schema', () => {
  const [tool] = proxyToolDefinitions(
    port({ tools: [{ name: 'ping' }], resources: [], prompts: [] }),
  );
  assert.deepEqual(tool!.inputSchema, { type: 'object' });
});

test('resources are prefixed and prompts are namespaced', () => {
  const catalog: UpstreamCatalog = {
    tools: [],
    resources: [{ uri: 'repo://readme', name: 'README', mimeType: 'text/markdown' }],
    prompts: [{ name: 'triage', description: 'Triage an issue', arguments: [{ name: 'id' }] }],
  };
  assert.deepEqual(proxyResourceEntries(port(catalog))[0]?.uri, 'mcp+github://repo://readme');
  assert.equal(proxyResourceEntries(port(catalog))[0]?.mimeType, 'text/markdown');
  assert.equal(proxyPromptEntries(port(catalog))[0]?.name, 'github__triage');
  assert.deepEqual(proxyPromptEntries(port(catalog))[0]?.arguments, [{ name: 'id' }]);
});

test('no registry configured yields empty lists', () => {
  assert.deepEqual(proxyToolDefinitions(undefined), []);
  assert.deepEqual(proxyResourceEntries(undefined), []);
  assert.deepEqual(proxyPromptEntries(undefined), []);
});
