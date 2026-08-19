import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOperationEnvelope } from '../../../packages/protocol/src/worker.js';
test('unknown raw operation is rejected before dispatch', () =>
  assert.throws(
    () => parseOperationEnvelope({ version: 1, operation: { kind: 'run' } }),
    /Unknown operation/,
  ));
