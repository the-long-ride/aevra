import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { ConnectorNote } from '@aevra/admin-contracts';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { ConnectionNoteEditor } from './ConnectionNoteEditor';
import { ConnectionNotesPanel } from './ConnectionNotesPanel';
import { notePreview } from './note-images';

const BASE = '/api/connector-notes/oauth%3AChatGPT';

const existing: ConnectorNote = {
  id: 'n1',
  actor: 'oauth:ChatGPT',
  title: 'note-1',
  text: 'Keep the plain test phrase',
  images: [],
  visibleToAi: true,
  aiCanDelete: false,
  readOnConnect: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function png(name: string) {
  return new File([new Uint8Array(8)], name, { type: 'image/png' });
}

test('pasting an image into the text area adds a removable thumbnail', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn(async () => undefined);
  render(
    <ConnectionNoteEditor actor="oauth:ChatGPT" note={null} onSave={onSave} onCancel={vi.fn()} />,
  );
  const file = png('');
  fireEvent.paste(screen.getByLabelText('Text'), {
    clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
  });
  const thumb = await screen.findByRole('img', { name: 'pasted-1' });
  expect(thumb.getAttribute('src')).toMatch(/^data:image\/png;base64,/);

  await user.click(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]).toEqual([
    {
      text: '',
      visibleToAi: true,
      aiCanDelete: false,
      readOnConnect: false,
      addImages: [{ name: 'pasted-1', dataBase64: thumb.getAttribute('src') }],
    },
  ]);

  await user.click(screen.getByRole('button', { name: 'Remove image pasted-1' }));
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('button', { name: 'Save note' })).toBeDisabled();
});

test('pasting plain text is left to the browser', () => {
  render(
    <ConnectionNoteEditor actor="oauth:ChatGPT" note={null} onSave={vi.fn()} onCancel={vi.fn()} />,
  );
  const event = fireEvent.paste(screen.getByLabelText('Text'), {
    clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] },
  });
  expect(event).toBe(true);
});

test('a cleared title on edit asks the server for a fresh name', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn(async () => undefined);
  render(
    <ConnectionNoteEditor
      actor="oauth:ChatGPT"
      note={existing}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );
  await user.clear(screen.getByLabelText('Title'));
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      text: 'Keep the plain test phrase',
      title: '',
      keepImageIds: [],
    }),
  );
});

test('cancel discards the draft and save errors keep the editor open', async () => {
  const user = userEvent.setup();
  const fetchMock = installApiFixtures({
    routes: { [BASE]: { actor: 'oauth:ChatGPT', notes: [existing] } },
    mutationResponses: {
      [`POST ${BASE}/notes`]: new Response(
        JSON.stringify({ error: { code: 'INVALID_CONNECTOR_NOTE', message: 'Note is too long' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    },
  });
  render(
    <DialogProvider>
      <ConnectionNotesPanel actor="oauth:ChatGPT" />
    </DialogProvider>,
  );
  await user.click(await screen.findByRole('button', { name: 'New note' }));
  await user.type(screen.getByLabelText('Text'), 'draft words');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Text')).toBeNull();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

  await user.click(screen.getByRole('button', { name: 'New note' }));
  await user.type(screen.getByLabelText('Text'), 'draft words');
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  expect(await screen.findByText('Note is too long')).toHaveClass('toast', 'error');
  expect(screen.getByLabelText('Text')).toHaveValue('draft words');
});

test('a failed notes load shows the server message', async () => {
  installApiFixtures();
  render(
    <DialogProvider>
      <ConnectionNotesPanel actor="oauth:ChatGPT" />
    </DialogProvider>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(`Unmocked GET ${BASE}`);
});

test('note previews collapse whitespace and cut long text', () => {
  expect(notePreview('a\n\n b')).toBe('a b');
  expect(notePreview('x'.repeat(100))).toBe(`${'x'.repeat(80)}…`);
});

test('opening the editor scrolls it into view and focuses Title', async () => {
  const user = userEvent.setup();
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  installApiFixtures({
    routes: { [BASE]: { actor: 'oauth:ChatGPT', notes: [existing] } },
  });
  render(
    <DialogProvider>
      <ConnectionNotesPanel actor="oauth:ChatGPT" />
    </DialogProvider>,
  );
  await user.click(await screen.findByRole('button', { name: 'New note' }));
  expect(screen.getByLabelText('Title')).toHaveFocus();
  expect(scroll).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('button', { name: 'Edit note-1' }));
  expect(screen.getByLabelText('Title')).toHaveFocus();
  expect(scroll).toHaveBeenCalledTimes(2);
});

test('editing sends only the switches changed in the editor, so table toggles are not overwritten', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn(async () => undefined);
  const note = { ...existing, aiCanDelete: true, readOnConnect: true };
  render(
    <ConnectionNoteEditor actor="oauth:ChatGPT" note={note} onSave={onSave} onCancel={vi.fn()} />,
  );
  await user.type(screen.getByLabelText('Text'), ' more');
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  const first = (onSave.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
  expect(first).not.toHaveProperty('visibleToAi');
  expect(first).not.toHaveProperty('aiCanDelete');
  expect(first).not.toHaveProperty('readOnConnect');

  await user.click(screen.getByRole('switch', { name: /Read on connect/ }));
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  const second = (onSave.mock.calls[1] as unknown[])[0] as Record<string, unknown>;
  expect(second).toMatchObject({ readOnConnect: false });
  expect(second).not.toHaveProperty('aiCanDelete');
});
