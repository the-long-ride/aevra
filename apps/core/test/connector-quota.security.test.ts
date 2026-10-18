import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectorAdmission } from '../src/mcp/connector-admission.js';
import { IpRateLimiter } from '../src/mcp/rate-limit.js';

test('invalid path-token traffic cannot exhaust valid connector quota on the same IP', async () => {
  const limiter = new IpRateLimiter(2, 0);
  let uses = 0;
  const admission = createConnectorAdmission(
    {
      findByToken: (value) => (value === 'valid phrase' ? { id: 'known', name: 'Sample' } : null),
      recordUse: () => {
        uses++;
      },
    },
    limiter,
  );
  for (let i = 0; i < 5; i++) await admission.verify('invalid phrase', '127.0.0.1');
  assert.equal((await admission.verify('valid phrase', '127.0.0.1')).kind, 'admitted');
  assert.equal(uses, 1);
});
