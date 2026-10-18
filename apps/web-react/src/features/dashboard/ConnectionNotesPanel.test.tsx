import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { ConnectorNote } from '@aevra/admin-contracts';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { ConnectionNotesPanel } from './ConnectionNotesPanel';

const BASE = '/api/connector-notes/oauth%3AChatGPT';

function note(overrides: Partial<ConnectorNote> = {}): ConnectorNote {
  return {
    id: 'n1',
    actor: 'oauth:ChatGPT',
    title: 'note-1',
    text: 'Remember the plain test phrase',
    images: [],
    visibleToAi: true,
    aiCanDelete: false,
    readOnConnect: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function setup(notes: ConnectorNote[], mutationResponses: Record<string, unknown> = {}) {
  const fetchMock = installApiFixtures({
    routes: { [BASE]: { actor: 'oauth:ChatGPT', notes } },
    mutationResponses,
  });
  render(
    <DialogProvider>
      <ConnectionNotesPanel actor="oauth:ChatGPT" />
    </DialogProvider>,
  );
  return fetchMock;
}

function call(fetchMock: ReturnType<typeof installApiFixtures>, path: string, method: string) {
  const found = fetchMock.mock.calls.find(
    ([input, init]) =>
      String(input) === path && String(init?.method ?? 'GET').toUpperCase() === method,
  );
  return found ? (JSON.parse(String(found[1]?.body ?? 'null')) as Record<string, unknown>) : null;
}

function png(name: string, bytes = 8) {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

test('shows the empty text and the per-note reading hint', async () => {
  setup([]);
  expect(
    await screen.findByText(
      'No notes yet. Notes are messages for the AI agent using this connector.',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      'Notes are read only when you mention them, except notes with Read on connect on.',
    ),
  ).toBeInTheDocument();
});

test('creating a note with a blank title posts no title and shows the server name', async () => {
  const user = userEvent.setup();
  const fetchMock = setup([], {
    [`POST ${BASE}/notes`]: note({ id: 'n3', title: 'note-3', text: 'Use the docs folder' }),
  });
  await user.click(await screen.findByRole('button', { name: 'New note' }));
  const save = screen.getByRole('button', { name: 'Save note' });
  expect(save).toBeDisabled();
  expect(screen.getByLabelText('Title')).toHaveAttribute(
    'placeholder',
    'note-N (filled automatically)',
  );
  await user.type(screen.getByLabelText('Text'), 'Use the docs folder');
  expect(save).toBeEnabled();
  await user.click(save);
  await waitFor(() =>
    expect(call(fetchMock, `${BASE}/notes`, 'POST')).toEqual({
      text: 'Use the docs folder',
      visibleToAi: true,
      aiCanDelete: false,
      readOnConnect: false,
    }),
  );
  expect(await screen.findByText('note-3')).toBeInTheDocument();
});

test('editing keeps only the images that were not removed', async () => {
  const user = userEvent.setup();
  const images = [
    { id: 'i1', name: 'a.png', mimeType: 'image/png' as const, sizeBytes: 10 },
    { id: 'i2', name: 'b.png', mimeType: 'image/png' as const, sizeBytes: 10 },
  ];
  const fetchMock = setup([note({ images })], {
    [`PATCH ${BASE}/notes/n1`]: note({ images: [images[1]!] }),
  });
  expect(await screen.findByText('2 image(s)')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit note-1' }));
  const thumbnail = screen.getByRole('img', { name: 'b.png' });
  expect(thumbnail).toHaveAttribute('src', `${BASE}/notes/n1/images/i2`);
  await user.click(screen.getByRole('button', { name: 'Remove image a.png' }));
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() =>
    expect(call(fetchMock, `${BASE}/notes/n1`, 'PATCH')).toEqual({
      title: 'note-1',
      text: 'Remember the plain test phrase',
      keepImageIds: ['i2'],
    }),
  );
  expect(await screen.findByText('1 image(s)')).toBeInTheDocument();
});

test('turning visibility off patches the note and disables the AI delete switch', async () => {
  const user = userEvent.setup();
  const fetchMock = setup([note()], {
    [`PATCH ${BASE}/notes/n1`]: note({ visibleToAi: false }),
  });
  const visible = await screen.findByRole('switch', { name: 'Visible to AI: note-1' });
  const aiDelete = screen.getByRole('switch', { name: 'AI can delete: note-1' });
  expect(aiDelete).toBeEnabled();
  await user.click(visible);
  await waitFor(() =>
    expect(call(fetchMock, `${BASE}/notes/n1`, 'PATCH')).toEqual({ visibleToAi: false }),
  );
  await waitFor(() => expect(aiDelete).toBeDisabled());
  expect(aiDelete.closest('[title]')).toHaveAttribute(
    'title',
    "Hidden notes can't be read or deleted by AI",
  );
});

test('AI delete switch patches aiCanDelete', async () => {
  const user = userEvent.setup();
  const fetchMock = setup([note()], {
    [`PATCH ${BASE}/notes/n1`]: note({ aiCanDelete: true }),
  });
  await user.click(await screen.findByRole('switch', { name: 'AI can delete: note-1' }));
  await waitFor(() =>
    expect(call(fetchMock, `${BASE}/notes/n1`, 'PATCH')).toEqual({ aiCanDelete: true }),
  );
});

test('deleting asks for confirmation and only deletes on confirm', async () => {
  const user = userEvent.setup();
  const fetchMock = setup([note()], { [`DELETE ${BASE}/notes/n1`]: { deleted: true } });
  await user.click(await screen.findByRole('button', { name: 'Delete note-1' }));
  let confirm = screen.getByRole('dialog', { name: 'Delete note?' });
  expect(confirm).toHaveTextContent('Permanently delete "note-1"? This cannot be undone.');
  await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  expect(call(fetchMock, `${BASE}/notes/n1`, 'DELETE')).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Delete note-1' }));
  confirm = screen.getByRole('dialog', { name: 'Delete note?' });
  await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input) === `${BASE}/notes/n1` && init?.method === 'DELETE',
      ),
    ).toBe(true),
  );
  expect(
    await screen.findByText(
      'No notes yet. Notes are messages for the AI agent using this connector.',
    ),
  ).toBeInTheDocument();
});

test('client-side image checks reject too many, too large and wrong-type files', async () => {
  const user = userEvent.setup({ applyAccept: false });
  setup([]);
  await user.click(await screen.findByRole('button', { name: 'New note' }));
  const input = screen.getByLabelText('Add images');
  expect(input).toHaveAttribute('accept', 'image/*');

  await user.upload(input, [png('1.png'), png('2.png'), png('3.png'), png('4.png'), png('5.png')]);
  expect(await screen.findByText('A note can have at most 4 images.')).toBeInTheDocument();

  await user.upload(input, png('big.png', 2 * 1024 * 1024 + 1));
  expect(await screen.findByText('Each image must be 2 MiB or smaller.')).toBeInTheDocument();

  await user.upload(input, new File(['plain words'], 'notes.txt', { type: 'text/plain' }));
  expect(await screen.findByText('Only image files can be added.')).toBeInTheDocument();

  await user.upload(input, png('ok.png'));
  expect(await screen.findByRole('img', { name: 'ok.png' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save note' })).toBeEnabled();
});

function gateMutations(failWith?: string) {
  const real = globalThis.fetch;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let mutations = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'GET') return real(input, init);
    mutations += 1;
    await gate;
    if (failWith) {
      return new Response(JSON.stringify({ error: failWith }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return real(input, init);
  }) as typeof fetch;
  return { release: open, count: () => mutations };
}

test('visible switch moves at once, is disabled while saving and sends one request', async () => {
  const user = userEvent.setup();
  setup([note()], { [`PATCH ${BASE}/notes/n1`]: note({ visibleToAi: false }) });
  const visible = await screen.findByRole('switch', { name: 'Visible to AI: note-1' });
  const aiDelete = screen.getByRole('switch', { name: 'AI can delete: note-1' });
  const gated = gateMutations();
  await user.click(visible);
  expect(visible).not.toBeChecked();
  expect(visible).toBeDisabled();
  expect(aiDelete).toBeDisabled();
  await user.click(visible);
  gated.release();
  await waitFor(() => expect(visible).toBeEnabled());
  expect(gated.count()).toBe(1);
  expect(visible).not.toBeChecked();
});

test('failed visible save reverts to the server value and shows the error', async () => {
  const user = userEvent.setup();
  setup([note()]);
  const visible = await screen.findByRole('switch', { name: 'Visible to AI: note-1' });
  const gated = gateMutations('plain failure');
  await user.click(visible);
  expect(visible).not.toBeChecked();
  gated.release();
  expect(await screen.findByText('plain failure')).toBeInTheDocument();
  await waitFor(() => expect(visible).toBeChecked());
  expect(visible).toBeEnabled();
});

test('AI delete switch is optimistic and locked while its request is in flight', async () => {
  const user = userEvent.setup();
  setup([note()], { [`PATCH ${BASE}/notes/n1`]: note({ aiCanDelete: true }) });
  const aiDelete = await screen.findByRole('switch', { name: 'AI can delete: note-1' });
  const gated = gateMutations();
  await user.click(aiDelete);
  expect(aiDelete).toBeChecked();
  expect(aiDelete).toBeDisabled();
  gated.release();
  await waitFor(() => expect(aiDelete).toBeEnabled());
  expect(aiDelete).toBeChecked();
  expect(gated.count()).toBe(1);
});

test('Edit and Delete use the workspace table icon action buttons', async () => {
  setup([note()]);
  const edit = await screen.findByRole('button', { name: 'Edit note-1' });
  const remove = screen.getByRole('button', { name: 'Delete note-1' });
  const cell = edit.parentElement!;
  expect(cell).toHaveClass('actions', 'workspace-row-actions');
  expect(remove.parentElement).toBe(cell);
  expect(edit).toHaveAttribute('title', 'Edit');
  expect(edit).toHaveAttribute('data-surface-id', 'connections:note-edit');
  expect(edit.querySelector('svg.workspace-action-icon')).not.toBeNull();
  expect(edit).not.toHaveTextContent('Edit');
  expect(remove).toHaveAttribute('title', 'Delete');
  expect(remove).toHaveAttribute('data-surface-id', 'connections:note-delete');
  expect(remove).toHaveClass('danger-button');
  expect(remove).toHaveTextContent('[x]');
});
