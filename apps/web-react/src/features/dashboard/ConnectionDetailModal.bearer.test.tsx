import { waitFor, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { grantControls, mutationCall, renderModal } from './connection-detail-test-utils';

test('Bearer connector lists granted workspaces and allows granting new workspace', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  const { onChanged } = renderModal({
    id: 'con-test-1',
    connectorId: 'con-test-1',
    client: 'test-1',
    name: 'test-1',
    actor: 'connector:test-1',
    authType: 'Bearer connector',
    status: 'DISCONNECTED',
    workspaceIds: [],
    workspaces: [],
    workspaceGrants: [],
  });

  expect(screen.getByText('No workspace granted to this connection.')).toBeInTheDocument();
  await user.click(grantControls().confirm);
  await waitFor(() =>
    expect(mutationCall(fetchMock, '/api/connectors/con-test-1/workspaces', 'POST')).toBeTruthy(),
  );
  const call = mutationCall(fetchMock, '/api/connectors/con-test-1/workspaces', 'POST');
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({
    workspaceId: 'ws-1',
    profileId: 'read-only',
  });
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

test('Bearer connector allows revoking a granted workspace', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures();
  const { onChanged } = renderModal({
    id: 'con-test-1',
    connectorId: 'con-test-1',
    client: 'test-1',
    name: 'test-1',
    actor: 'connector:test-1',
    authType: 'Bearer connector',
    status: 'DISCONNECTED',
    workspaceIds: ['ws-1'],
    workspaces: ['Aevra'],
    workspaceGrants: [{ workspaceId: 'ws-1', profileId: 'developer' }],
  });

  expect(screen.getByText('Aevra')).toBeInTheDocument();
  const removeBtn = screen.getByRole('button', { name: 'Remove' });
  await user.click(removeBtn);

  const confirmDialog = screen.getByRole('dialog', { name: 'Remove workspace grant' });
  expect(confirmDialog).toBeInTheDocument();
  await user.click(within(confirmDialog).getByRole('button', { name: 'Remove' }));

  await waitFor(() =>
    expect(
      mutationCall(fetchMock, '/api/connectors/con-test-1/workspaces/ws-1', 'DELETE'),
    ).toBeTruthy(),
  );
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});
