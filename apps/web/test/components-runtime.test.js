import { afterEach, expect, test, vi } from 'vitest';
import { mountDataTable, resetDataTable } from '../components/data-table.js';
import { closeModal, openModal } from '../components/modal.js';
import { openPermissionBulkEditor } from '../components/permission-bulk.js';
import { remoteAccessMarkup, wireRemoteAccess } from '../components/remote-access.js';
import {
  announceNewRequests,
  notificationButtonLabel,
  requestNotificationPermission,
} from '../components/request-notifications.js';

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function settle(cycles = 8) {
  for (let index = 0; index < cycles; index += 1) await Promise.resolve();
}

afterEach(() => {
  closeModal();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

test('DataTable covers search filters sort paging page size and row actions', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const rows = Array.from({ length: 30 }, (_, index) => ({
    id: `row-${index + 1}`,
    name: index === 0 ? 'Alpha' : `Row ${index + 1}`,
    effect: index % 2 ? 'allow' : 'deny',
    score: 30 - index,
  }));
  const onAction = vi.fn();
  resetDataTable('component-table');
  mountDataTable(container, {
    id: 'component-table',
    rows,
    pageSize: 10,
    pageSizes: [5, 10, 25],
    searchPlaceholder: 'Search rows…',
    filters: [{ key: 'effect', label: 'Effect' }],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'effect', label: 'Effect' },
      { key: 'score', label: 'Score' },
      {
        key: 'actions',
        label: '',
        sortable: false,
        search: false,
        render: () => '<button data-table-action="inspect">Inspect</button>',
      },
    ],
    rowKey: (row) => row.id,
    onAction,
  });

  expect(container.textContent).toContain('Page 1 / 3');
  const search = container.querySelector('[data-dt-search]');
  search.value = 'Alpha';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  expect(container.textContent).toContain('Alpha');
  expect(container.textContent).toContain('1–1 of 1');

  search.value = '';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  const effect = container.querySelector('[data-dt-filter="effect"]');
  effect.value = 'allow';
  effect.dispatchEvent(new Event('change', { bubbles: true }));
  expect(container.textContent).toContain('of 15');

  container.querySelector('[data-dt-sort="score"]').click();
  container.querySelector('[data-dt-sort="score"]').click();
  container.querySelector('[data-dt-page="next"]').click();
  expect(container.textContent).toContain('Page 2 / 2');
  container.querySelector('[data-dt-page="first"]').click();

  const size = container.querySelector('[data-dt-size]');
  size.value = '5';
  size.dispatchEvent(new Event('change', { bubbles: true }));
  expect(container.textContent).toContain('Page 1 / 3');

  container.querySelector('[data-table-action="inspect"]').click();
  expect(onAction).toHaveBeenCalledWith(
    'inspect',
    expect.objectContaining({ effect: 'allow' }),
    expect.anything(),
    expect.anything(),
  );
});

test('modal renders onReady content and closes from its explicit close control', () => {
  const onReady = vi.fn();
  openModal('Example modal', '<p id="modal-value">Ready</p>', { onReady });
  expect(document.querySelector('#modal-value')?.textContent).toBe('Ready');
  expect(onReady).toHaveBeenCalledTimes(1);
  document.querySelector('[data-close-modal]').click();
  expect(document.querySelector('.modal-backdrop')).toBeNull();
});

test('Remote Access authenticates tests saves and copies the canonical endpoint', async () => {
  const fetchMock = vi.fn(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === '/api/cloudflare/authenticate') return json({ message: 'Authentication checked.' });
    if (url === '/api/cloudflare/test') return json({ reachable: true, status: 200 });
    if (url === '/api/cloudflare/setup') {
      return json({ result: { hostname: 'aevra.example.com' } });
    }
    return json({ error: { message: 'Unexpected request' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
  const scope = document.createElement('div');
  scope.innerHTML = remoteAccessMarkup(
    {
      found: true,
      authenticated: true,
      hostname: 'aevra.example.com',
      tunnelId: 'tunnel-1',
      ownership: 'managed',
    },
    'component',
  );
  document.body.append(scope);
  const reload = vi.fn(async () => undefined);
  wireRemoteAccess(scope, {}, 'component', reload);

  scope.querySelector('#component-authenticate').click();
  await settle();
  expect(scope.querySelector('#component-result')?.textContent).toContain(
    'Authentication checked',
  );

  scope.querySelector('#component-test').click();
  await settle();
  expect(scope.querySelector('#component-result')?.textContent).toContain(
    'Endpoint reachable',
  );

  scope.querySelector('[data-copy-endpoint]').click();
  await settle();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    'https://aevra.example.com/mcp',
  );

  scope
    .querySelector('#component-cloudflare')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(reload).toHaveBeenCalled();
});

test('bulk permissions expands commands, warns on wildcard, and submits normalized targets', async () => {
  const fetchMock = vi.fn(async () => json({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  const reload = vi.fn(async () => undefined);
  openPermissionBulkEditor(
    {
      workspaces: [{ id: 'ws-1', name: 'Aevra' }],
      sessions: [{ id: 'session-1', actor: 'connector:ChatGPT' }],
      connectors: [{ name: 'ChatGPT', lastUsedAt: '2026-08-19T00:00:00Z' }],
      oauthClients: [{ clientName: 'Claude', actor: 'oauth:Claude' }],
    },
    reload,
  );

  const form = document.querySelector('#permission-bulk');
  const command = [...form.querySelectorAll('[name=capability]')].find(
    (input) => input.value === 'commands.run',
  );
  command.checked = true;
  command.dispatchEvent(new Event('change', { bubbles: true }));
  const matcher = form.querySelector('[name=commandMatchers]');
  matcher.value = 'git:status\n*\ngit:status';
  matcher.dispatchEvent(new Event('input', { bubbles: true }));
  expect(form.querySelector('[data-command-matchers]').hidden).toBe(false);
  expect(form.querySelector('[data-matcher-warning]').hidden).toBe(false);
  expect(form.querySelector('[data-create]').disabled).toBe(false);

  form.querySelector('[data-clear]').click();
  expect(form.querySelector('[data-create]').disabled).toBe(true);
  form.querySelector('[data-select-all]').click();
  matcher.dispatchEvent(new Event('input', { bubbles: true }));
  expect(form.querySelector('[data-create]').disabled).toBe(false);

  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/permissions/bulk',
    expect.objectContaining({ method: 'POST' }),
  );
  expect(reload).toHaveBeenCalled();
});

test('request notification state announces new items once and can request permission', async () => {
  class FakeNotification {
    static permission = 'granted';
    static requestPermission = vi.fn(async () => 'granted');
    static created = [];
    constructor(title, options) {
      FakeNotification.created.push({ title, options });
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  expect(notificationButtonLabel()).toBe('Browser notifications enabled');

  const approvals = [
    {
      id: 'approval-component',
      state: 'PENDING',
      actor: 'ChatGPT',
      operation: { family: 'git:status' },
      presentation: { title: 'Command request', action: 'Run', target: 'git status' },
    },
  ];
  const oauth = [
    {
      id: 'oauth-component',
      clientName: 'Claude',
      requestedScopes: ['mcp'],
    },
  ];
  announceNewRequests(approvals, oauth);
  const firstCount = document.querySelectorAll('.toast').length;
  announceNewRequests(approvals, oauth);
  expect(document.querySelectorAll('.toast').length).toBe(firstCount);
  expect(FakeNotification.created).toHaveLength(2);

  announceNewRequests([], []);
  announceNewRequests(approvals, []);
  expect(FakeNotification.created).toHaveLength(3);
  expect(await requestNotificationPermission()).toBe('granted');
  expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
});
