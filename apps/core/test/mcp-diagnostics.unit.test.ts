import assert from 'node:assert/strict';
import test from 'node:test';
import { McpDiagnostics } from '../src/mcp/diagnostics.js';

test('MCP diagnostics distinguish client, initialization, and tool traffic', () => {
  const diagnostics = new McpDiagnostics();
  assert.equal(diagnostics.snapshot().hint, 'stopped');

  diagnostics.listening();
  assert.equal(diagnostics.snapshot().hint, 'no-client-traffic');

  diagnostics.recordInbound('POST');
  assert.equal(diagnostics.snapshot().hint, 'traffic-no-initialize');

  diagnostics.recordMethod('initialize');
  diagnostics.recordIdentity('oauth:ChatGPT', 'ses_1');
  let snapshot = diagnostics.snapshot();
  assert.equal(snapshot.hint, 'initialized-no-tools');
  assert.equal(snapshot.initializeCount, 1);
  assert.equal(snapshot.lastActor, 'oauth:ChatGPT');

  diagnostics.recordInbound('POST');
  diagnostics.recordMethod('tools/call');
  diagnostics.recordToolCall('workspace_list', 'ses_1');
  snapshot = diagnostics.snapshot();
  assert.equal(snapshot.hint, 'active');
  assert.equal(snapshot.toolCallCount, 1);
  assert.equal(snapshot.lastToolName, 'workspace_list');

  diagnostics.stopped();
  assert.equal(diagnostics.snapshot().hint, 'stopped');
});
