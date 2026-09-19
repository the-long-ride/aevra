import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminServer } from '../src/admin/server.js';

async function request(url: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    headers: { cookie: 'aevra_admin=test', ...(init.headers ?? {}) },
  });
}

function mutationHeaders(origin: string) {
  return {
    origin,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
  };
}

test('admin can enable YOLO from a pending connector request and disable it explicitly', async () => {
  const bootstrap = { validateSession: (value: string | undefined) => value === 'test' } as any;
  let yolo = false;
  let state = 'PENDING';
  const ticket = {
    id: 'req_yolo',
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_yolo',
    workspaceId: 'ws_1',
    risk: 'HIGH',
    operation: { family: 'commands:npm-test', capability: 'commands.run' },
  };
  const approvals = {
    status: () => ({ ...ticket, state }),
    approve: (_id: string, scope: string) => {
      assert.equal(scope, 'once');
      state = 'APPROVED';
      return { ...ticket, state };
    },
  };
  const sessions = {
    get: (id: string) => (id === ticket.sessionId ? { id, actor: ticket.actor } : null),
    enableYolo: (id: string) => {
      assert.equal(id, ticket.sessionId);
      yolo = true;
      return { sessionId: id, enabled: true };
    },
    disableYolo: (id: string) => {
      assert.equal(id, ticket.sessionId);
      yolo = false;
      return { sessionId: id, enabled: false };
    },
  };
  const auditEvents: any[] = [];
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    api: { approvals, sessions, audit: { append: (event: any) => auditEvents.push(event) } } as any,
  });
  await server.start();

  const enabled = await request(`${server.url()}/api/approvals/${ticket.id}/yolo`, {
    method: 'POST',
    headers: mutationHeaders(server.url()),
    body: '{}',
  });
  assert.equal(enabled.status, 200);
  assert.equal(yolo, true);
  assert.equal(state, 'APPROVED');

  const disabled = await request(`${server.url()}/api/sessions/${ticket.sessionId}/yolo`, {
    method: 'DELETE',
    headers: mutationHeaders(server.url()),
  });
  assert.equal(disabled.status, 200);
  assert.equal(yolo, false);
  assert.deepEqual(
    auditEvents.map((event) => event.operation),
    ['session.yolo.enable', 'session.yolo.disable'],
  );
  await server.close();
});

test('admin can enable YOLO from an already-approved or expired connector request', async () => {
  const bootstrap = { validateSession: (value: string | undefined) => value === 'test' } as any;
  let yolo = false;
  let state = 'APPROVED';
  const ticket = {
    id: 'req_already_approved',
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_approved',
    workspaceId: 'ws_1',
    risk: 'CRITICAL',
    operation: { family: 'commands:pnpm-format', capability: 'commands.run' },
  };
  const approvals = {
    status: () => ({ ...ticket, state }),
    approve: (_id: string, _scope: string) => {
      throw new Error('Should not re-approve an already approved ticket');
    },
  };
  const sessions = {
    get: (id: string) => (id === ticket.sessionId ? { id, actor: ticket.actor } : null),
    enableYolo: (id: string) => {
      assert.equal(id, ticket.sessionId);
      yolo = true;
      return { sessionId: id, enabled: true };
    },
  };
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    api: { approvals, sessions, audit: { append: () => {} } } as any,
  });
  await server.start();

  // Enabling YOLO on an already-approved request succeeds
  const resApproved = await request(`${server.url()}/api/approvals/${ticket.id}/yolo`, {
    method: 'POST',
    headers: mutationHeaders(server.url()),
    body: '{}',
  });
  assert.equal(resApproved.status, 200);
  assert.equal(yolo, true);

  // Enabling YOLO on an expired request succeeds
  state = 'EXPIRED';
  const resExpired = await request(`${server.url()}/api/approvals/${ticket.id}/yolo`, {
    method: 'POST',
    headers: mutationHeaders(server.url()),
    body: '{}',
  });
  assert.equal(resExpired.status, 200);

  // Approving an already-approved request is idempotent and returns 200
  state = 'APPROVED';
  const resApproveAgain = await request(`${server.url()}/api/approvals/${ticket.id}/approve`, {
    method: 'POST',
    headers: mutationHeaders(server.url()),
    body: JSON.stringify({ scope: 'once' }),
  });
  assert.equal(resApproveAgain.status, 200);

  await server.close();
});
