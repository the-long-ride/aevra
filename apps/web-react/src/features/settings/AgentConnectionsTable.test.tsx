import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AgentConnectionsTable } from './AgentConnectionsTable';
import type { AgentRegistration } from './agent-service';
import { globalCodex, workspaceClaude, workspaces } from './agent-integrations.test-support';

function mount(registrations: AgentRegistration[] = [globalCodex, workspaceClaude]) {
  const onRemove = vi.fn();
  render(
    <AgentConnectionsTable
      registrations={registrations}
      workspaces={workspaces}
      pending={null}
      status="ready"
      onUpdate={vi.fn()}
      onRemove={onRemove}
    />,
  );
  return onRemove;
}

const removeCodex = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Remove Aevra from codex (Global)' }));

it('asks for confirmation naming the agent and scope before removing', () => {
  const onRemove = mount();
  removeCodex();
  expect(onRemove).not.toHaveBeenCalled();
  const prompt = screen.getByRole('group', { name: 'Remove codex (Global)?' });
  expect(within(prompt).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  fireEvent.click(
    within(prompt).getByRole('button', { name: 'Confirm removing Aevra from codex (Global)' }),
  );
  expect(onRemove).toHaveBeenCalledWith(globalCodex);
  expect(screen.queryByRole('group', { name: 'Remove codex (Global)?' })).not.toBeInTheDocument();
});

it('Cancel and Escape close the confirmation without removing', () => {
  const onRemove = mount();
  removeCodex();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Remove Aevra from codex (Global)' })).toHaveFocus();
  removeCodex();
  fireEvent.keyDown(screen.getByRole('group', { name: 'Remove codex (Global)?' }), {
    key: 'Escape',
  });
  expect(screen.queryByRole('group', { name: 'Remove codex (Global)?' })).not.toBeInTheDocument();
  expect(onRemove).not.toHaveBeenCalled();
});

it('shows Credential missing when the connector is gone, and Never used otherwise', () => {
  mount([
    { ...globalCodex, state: 'incomplete', connectorMissing: true },
    { ...workspaceClaude, lastUsedAt: null },
  ]);
  const [, gone, unused] = screen.getAllByRole('row');
  expect(within(gone!).getByText('Credential missing')).toBeInTheDocument();
  expect(within(gone!).queryByText('Never used')).not.toBeInTheDocument();
  expect(within(unused!).getByText('Never used')).toBeInTheDocument();
});

it('renders action buttons with refresh icon for update and [x] for remove', () => {
  mount();
  const updateBtn = screen.getByRole('button', { name: 'Update Aevra for codex (Global)' });
  const removeBtn = screen.getByRole('button', { name: 'Remove Aevra from codex (Global)' });
  expect(updateBtn.querySelector('svg')).toBeInTheDocument();
  expect(removeBtn).toHaveTextContent('[x]');
});
