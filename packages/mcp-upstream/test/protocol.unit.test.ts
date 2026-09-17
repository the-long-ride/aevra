import assert from 'node:assert/strict';
import test from 'node:test';
import { UpstreamError, parseJsonRpcMessage } from '../src/protocol.js';

test('a reply with a numeric id parses as a response', () => {
  const message = parseJsonRpcMessage('{"jsonrpc":"2.0","id":7,"result":{"ok":true}}');
  assert.equal(message?.type, 'response');
  assert.deepEqual(message?.type === 'response' ? message.response.result : null, { ok: true });
});

test('a message with a method and no id parses as a notification', () => {
  const message = parseJsonRpcMessage(
    '{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}',
  );
  assert.equal(message?.type, 'notification');
  assert.equal(
    message?.type === 'notification' ? message.notification.method : '',
    'notifications/tools/list_changed',
  );
});

test('unparsable or non-JSON-RPC lines are dropped rather than guessed at', () => {
  assert.equal(parseJsonRpcMessage('starting server...'), null);
  assert.equal(parseJsonRpcMessage('{"id":1}'), null);
  assert.equal(parseJsonRpcMessage('{"jsonrpc":"1.0","id":1}'), null);
  assert.equal(parseJsonRpcMessage('{"jsonrpc":"2.0"}'), null);
});

test('UpstreamError carries a machine-readable code and optional details', () => {
  const error = new UpstreamError('UPSTREAM_TIMEOUT', 'tools/list exceeded its deadline', {
    ms: 10,
  });
  assert.equal(error.code, 'UPSTREAM_TIMEOUT');
  assert.equal(error.name, 'UpstreamError');
  assert.deepEqual(error.details, { ms: 10 });
  assert.ok(error instanceof Error);
});
