import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransport } from '../src/create-transport.js';
import { HttpTransport } from '../src/http-transport.js';
import { SseTransport } from '../src/sse-transport.js';
import { StdioTransport } from '../src/stdio-transport.js';

test('each config kind produces its own transport', () => {
  assert.ok(
    createTransport({ transport: 'stdio', command: 'node', args: [] }) instanceof StdioTransport,
  );
  assert.ok(
    createTransport({ transport: 'http', url: 'https://x.test/mcp' }) instanceof HttpTransport,
  );
  assert.ok(
    createTransport({ transport: 'sse', url: 'https://x.test/sse' }) instanceof SseTransport,
  );
});

test('an unknown transport is rejected rather than defaulted', () => {
  assert.throws(
    () => createTransport({ transport: 'carrier-pigeon' } as never),
    /Unsupported upstream transport/,
  );
});
