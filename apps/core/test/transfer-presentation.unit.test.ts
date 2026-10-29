import assert from 'node:assert/strict';
import test from 'node:test';
import { presentApproval } from '../src/approvals/request-presentation.js';

function ticket(transfer: unknown): any {
  return {
    id: 'req_1',
    actor: 'connector:test',
    sessionId: 's1',
    workspaceId: 'w1',
    operation: { family: 'files:transfer', capability: 'files.write', risk: 'HIGH', argsHash: 'h' },
    payload: { tool: 'capability_request', requestedCapability: 'files.write', transfer },
    risk: 'HIGH',
    state: 'PENDING',
  };
}

test('files:transfer tickets list path, source and size per entry', () => {
  const view = presentApproval(
    ticket({
      direction: 'download',
      headersSupplied: 1,
      entries: [
        { path: '/in/a.txt', source: 'inline', bytes: 5 },
        { path: '/in/b.bin', source: 'url', host: 'files.example', bytes: 3 * 1024 * 1024 },
      ],
    }),
  );
  assert.equal(view.title, 'File transfer');
  assert.match(view.action, /2 files/);
  assert.match(view.preview ?? '', /\/in\/a\.txt {2}inline {2}5 B/);
  assert.match(view.preview ?? '', /\/in\/b\.bin {2}files\.example {2}3\.0 MB/);
  assert.match(view.preview ?? '', /headers: 1 supplied/);
});

test('an upload ticket reads as a send', () => {
  const view = presentApproval(
    ticket({
      direction: 'upload',
      headersSupplied: 0,
      entries: [{ path: '/out/r.pdf', source: 'inline', bytes: 2048 }],
    }),
  );
  assert.match(view.action, /Send 1 file/);
  assert.doesNotMatch(view.preview ?? '', /headers/);
});
