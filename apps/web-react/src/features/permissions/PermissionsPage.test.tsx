import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { PermissionsPage } from './PermissionsPage';

test('permission form renders every capability as a switch including skills and instructions', async () => {
  const user = userEvent.setup();
  installApiFixtures({ routes: { '/api/permissions': [] } });
  render(
    <DialogProvider>
      <PermissionsPage />
    </DialogProvider>,
  );
  await user.click(await screen.findByRole('button', { name: 'Add rules' }));

  for (const capability of [
    'files.read',
    'files.search',
    'git.read',
    'skills.read',
    'instructions.read',
    'files.write',
    'files.delete',
    'commands.run',
    'git.commit',
    'git.push',
    'network',
    'skills.write',
    'instructions.write',
    'mcp.proxy',
  ]) {
    expect(screen.getByRole('switch', { name: capability })).toBeInTheDocument();
  }
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

  await user.click(screen.getByRole('switch', { name: 'commands.run' }));
  expect(screen.getByLabelText(/Command matchers/)).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'commands.run' })).toHaveFocus();
});

test('permission form allows searching and selecting workspace and session by name', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/permissions': [],
      '/api/workspaces': [
        { id: 'ws-quotashift', name: 'Quotashift', hostRoot: '/repos/quotashift' },
      ],
      '/api/sessions': [
        { id: 'ses-chatgpt-42', actor: 'oauth:ChatGPT', lease: { workspaceId: 'ws-quotashift' } },
      ],
    },
  });

  render(
    <DialogProvider>
      <PermissionsPage />
    </DialogProvider>,
  );

  await user.click(await screen.findByRole('button', { name: 'Add rules' }));

  // Search workspace by name
  const wsInput = screen.getByLabelText('Workspace IDs');
  await user.type(wsInput, 'Quota');

  const wsOption = await screen.findByRole('option', { name: /Quotashift/i });
  expect(wsOption).toBeInTheDocument();
  await user.click(wsOption);

  expect(screen.getByRole('button', { name: 'Remove Quotashift' })).toBeInTheDocument();

  // Search session by name/actor
  const sessionInput = screen.getByLabelText('Session IDs');
  await user.type(sessionInput, 'ChatGPT');

  const sessionOption = await screen.findByRole('option', { name: /ChatGPT/i });
  expect(sessionOption).toBeInTheDocument();
  await user.click(sessionOption);

  expect(screen.getByRole('button', { name: /Remove oauth:ChatGPT/i })).toBeInTheDocument();

  // Fill in required actors
  await user.type(screen.getByLabelText('Connector actors'), 'oauth:ChatGPT');

  await user.click(screen.getByRole('button', { name: 'Create rules' }));

  const bulkCalls = fetchMock.mock.calls.filter(
    ([url, init]) => url === '/api/permissions/bulk' && init?.method === 'POST',
  );
  expect(bulkCalls.length).toBe(1);
  const payload = JSON.parse(String(bulkCalls[0][1]?.body));
  expect(payload.workspaceIds).toEqual(['ws-quotashift']);
  expect(payload.sessionIds).toEqual(['ses-chatgpt-42']);
});

test('handles submit failure and displays error in modal', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    routes: { '/api/permissions': [] },
    mutationResponses: {
      'POST /api/permissions/bulk': new Response(
        JSON.stringify({ error: { message: 'Failed to create rules' } }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    },
  });

  render(
    <DialogProvider>
      <PermissionsPage />
    </DialogProvider>,
  );

  await user.click(await screen.findByRole('button', { name: 'Add rules' }));
  await user.type(screen.getByLabelText('Connector actors'), 'agent');
  await user.click(screen.getByRole('button', { name: 'Create rules' }));

  expect(await screen.findByText('Failed to create rules')).toBeInTheDocument();
});

test('handles revoke confirmation and cancellation', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: {
      '/api/permissions': [
        {
          id: 'rule-1',
          effect: 'ALLOW',
          scope: 'workspace',
          actors: ['agent'],
          capabilities: ['files.read'],
          workspaceIds: ['ws-1'],
          sessionIds: [],
        },
      ],
      '/api/workspaces': [{ id: 'ws-1', name: '', hostRoot: '' }],
      '/api/sessions': [{ id: 'ses-1', actor: '', lease: { workspaceId: 'ws-missing' } }],
    },
  });

  render(
    <DialogProvider>
      <PermissionsPage />
    </DialogProvider>,
  );

  expect(await screen.findByText('ALLOW')).toBeInTheDocument();
  const revokeBtn = screen.getByRole('button', { name: 'Revoke' });

  // 1. Cancel revoke
  await user.click(revokeBtn);
  const cancelDialog = screen.getByRole('dialog', { name: 'Revoke permission rule' });
  await user.click(within(cancelDialog).getByRole('button', { name: 'Cancel' }));
  expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE')).toBe(false);

  // 2. Confirm revoke
  await user.click(revokeBtn);
  const confirmDialog = screen.getByRole('dialog', { name: 'Revoke permission rule' });
  await user.click(within(confirmDialog).getByRole('button', { name: 'Revoke' }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE')).toBe(true),
  );
});

test('submits with commands.run and parsed command matchers', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: { '/api/permissions': [] },
  });

  render(
    <DialogProvider>
      <PermissionsPage />
    </DialogProvider>,
  );

  await user.click(await screen.findByRole('button', { name: 'Add rules' }));
  await user.type(screen.getByLabelText('Connector actors'), 'agent-x');
  await user.click(screen.getByRole('switch', { name: 'commands.run' }));

  const matchersInput = screen.getByLabelText(/Command matchers/);
  await user.type(matchersInput, 'git:status{enter}git:diff');

  await user.click(screen.getByRole('button', { name: 'Create rules' }));

  await waitFor(() => {
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/permissions/bulk' && init?.method === 'POST',
    );
    expect(postCall).toBeTruthy();
    const payload = JSON.parse(String(postCall?.[1]?.body));
    expect(payload.commandMatchers).toEqual(['git:status', 'git:diff']);
    expect(payload.capabilities).toContain('commands.run');
  });
});

test('handles workspaces and sessions load failure gracefully', async () => {
  installApiFixtures({
    routes: {
      '/api/permissions': [
        {
          id: 'rule-fallback',
          effect: 'ALLOW',
          scope: 'all',
          actors: ['*'],
          capabilities: ['files.read'],
        },
      ],
      '/api/workspaces': new Response('{}', { status: 500 }),
      '/api/sessions': new Response('{}', { status: 500 }),
    },
  });

  render(
    <DialogProvider>
      <PermissionsPage />
    </DialogProvider>,
  );

  expect(await screen.findByText('ALLOW')).toBeInTheDocument();
});

test('handles edge case option labels for workspace and session selectors', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    routes: {
      '/api/permissions': [],
      '/api/workspaces': [
        { id: 'ws-bare', name: 'ws-bare', hostRoot: '' },
        { id: 'ws-noroot', name: '', hostRoot: '' },
      ],
      '/api/sessions': [
        { id: 'ses-bare', actor: '', lease: { workspaceId: 'ws-unmatched' } },
        { id: 'ses-nolease' },
      ],
    },
  });

  render(
    <DialogProvider>
      <PermissionsPage />
    </DialogProvider>,
  );

  await user.click(await screen.findByRole('button', { name: 'Add rules' }));
  expect(screen.getByLabelText('Workspace IDs')).toBeInTheDocument();
  expect(screen.getByLabelText('Session IDs')).toBeInTheDocument();
});
