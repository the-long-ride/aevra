import { render, screen } from '@testing-library/react';
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
