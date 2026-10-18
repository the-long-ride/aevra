import assert from 'node:assert/strict';
import test from 'node:test';
import { editConfig } from '../src/config-edit.js';

const entry = { command: 'tool' };

test('editConfig refuses an array or scalar parent with AGENT_CONFIG_INVALID', () => {
  const nested = ['projects', 'F:/x', 'mcpServers'];
  assert.throws(
    () => editConfig('{"projects":{"F:/x":[]}}', 'json', nested, 'aevra', entry),
    /AGENT_CONFIG_INVALID/,
  );
  assert.throws(
    () => editConfig('{"projects":{"F:/x":5}}', 'jsonc', nested, 'aevra', entry),
    /AGENT_CONFIG_INVALID/,
  );
  assert.throws(
    () => editConfig('{"mcpServers":5}', 'json', ['mcpServers'], 'aevra', entry),
    /AGENT_CONFIG_INVALID/,
  );
  assert.throws(
    () => editConfig('{"mcpServers":[]}', 'json', ['mcpServers'], 'aevra'),
    /AGENT_CONFIG_INVALID/,
  );
  assert.throws(
    () => editConfig('mcp_servers = 5\n', 'toml', ['mcp_servers'], 'aevra', entry),
    /AGENT_CONFIG_INVALID/,
  );
});
