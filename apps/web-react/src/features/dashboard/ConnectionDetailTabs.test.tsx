import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { ConnectionDetailModal, type ActiveConnection } from './ConnectionDetailModal';

const workspaces: WorkspaceSummary[] = [{ id: 'ws-1', name: 'Aevra', hostRoot: '/repo' }];

const connection: ActiveConnection = {
  id: 'ses-chatgpt',
  client: 'ChatGPT',
  actor: 'oauth:ChatGPT',
  authType: 'OAuth',
  workspaceIds: [],
};

function notesRoutes() {
  return {
    '/api/connector-notes/oauth%3AChatGPT': {
      actor: 'oauth:ChatGPT',
      notes: [],
    },
  };
}

function modal(value: ActiveConnection) {
  return (
    <DialogProvider>
      <ConnectionDetailModal
        connection={value}
        workspaces={workspaces}
        onClose={vi.fn()}
        onChanged={vi.fn(async () => undefined)}
      />
    </DialogProvider>
  );
}

test('Details and Notes tabs switch panels with proper tab semantics', async () => {
  const user = userEvent.setup();
  installApiFixtures({ routes: notesRoutes() });
  render(modal(connection));

  const tablist = screen.getByRole('tablist', { name: 'Connection sections' });
  const details = within(tablist).getByRole('tab', { name: 'Details' });
  const notes = within(tablist).getByRole('tab', { name: 'Notes' });
  expect(details).toHaveAttribute('aria-selected', 'true');
  expect(notes).toHaveAttribute('aria-selected', 'false');
  expect(notes).toHaveAttribute('data-surface-id', 'connections:notes-tab');
  expect(screen.getByRole('tabpanel', { name: 'Details' })).toHaveTextContent('Workspaces');

  await user.click(notes);
  expect(notes).toHaveAttribute('aria-selected', 'true');
  const panel = screen.getByRole('tabpanel', { name: 'Notes' });
  expect(await within(panel).findByRole('button', { name: 'New note' })).toBeInTheDocument();
  expect(screen.queryByRole('tabpanel', { name: 'Details' })).toBeNull();
});

test('the selected tab resets to Details when a different connection opens', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    routes: {
      ...notesRoutes(),
      '/api/connector-notes/oauth%3AOther': {
        actor: 'oauth:Other',
        notes: [],
      },
    },
  });
  const view = render(modal(connection));
  await user.click(screen.getByRole('tab', { name: 'Notes' }));
  expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');

  view.rerender(modal({ ...connection }));
  expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');

  view.rerender(modal({ ...connection, id: 'ses-other', client: 'Other', actor: 'oauth:Other' }));
  expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel', { name: 'Details' })).toBeInTheDocument();
});

test('the Notes tab is hidden when the connection has no actor', () => {
  installApiFixtures();
  render(modal({ ...connection, actor: undefined }));
  expect(screen.queryByRole('tab', { name: 'Notes' })).toBeNull();
  expect(screen.getByText('Workspaces')).toBeInTheDocument();
});

test('footer keeps YOLO and Revoke actions with Revoke in danger style', () => {
  installApiFixtures({ routes: notesRoutes() });
  render(modal({ ...connection, yolo: false }));
  const revoke = screen.getByRole('button', { name: 'Revoke session' });
  expect(revoke).toHaveClass('danger-button');
  expect(revoke.closest('footer')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Enable YOLO' }).closest('footer')).toBe(
    revoke.closest('footer'),
  );
});

test('arrow keys move between tabs and focus the selected tab', async () => {
  const user = userEvent.setup();
  installApiFixtures({ routes: notesRoutes() });
  render(modal(connection));
  screen.getByRole('tab', { name: 'Details' }).focus();
  await user.keyboard('{ArrowRight}');
  const notes = screen.getByRole('tab', { name: 'Notes' });
  expect(notes).toHaveAttribute('aria-selected', 'true');
  expect(notes).toHaveFocus();
  await user.keyboard('{ArrowLeft}');
  expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  await user.keyboard('{ArrowLeft}');
  expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
});

test('every aria-controls points at a rendered element', () => {
  installApiFixtures({ routes: notesRoutes() });
  render(modal(connection));
  for (const tab of screen.getAllByRole('tab')) {
    const controls = tab.getAttribute('aria-controls');
    if (controls) expect(document.getElementById(controls)).not.toBeNull();
  }
  expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-controls');
});

const note = (id: string, title: string) => ({
  id,
  actor: 'oauth:ChatGPT',
  title,
  text: 'text',
  images: [],
  visibleToAi: true,
  aiCanDelete: false,
  readOnConnect: false,
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
});

test('the Notes tab label shows the note count once there are notes', async () => {
  installApiFixtures({
    routes: {
      '/api/connector-notes/oauth%3AChatGPT': {
        actor: 'oauth:ChatGPT',
        notes: [note('n1', 'note-1'), note('n2', 'note-2')],
      },
    },
  });
  render(modal(connection));
  expect(await screen.findByRole('tab', { name: 'Notes (2)' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Details' })).toBeInTheDocument();
});

test('the Notes tab label has no count while the connection has no notes', async () => {
  installApiFixtures({ routes: notesRoutes() });
  render(modal(connection));
  await screen.findByRole('tab', { name: 'Notes' });
  expect(screen.queryByRole('tab', { name: /Notes \(/ })).toBeNull();
});
