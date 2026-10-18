import { readFileSync } from 'node:fs';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { ConnectorNote } from '@aevra/admin-contracts';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { ConnectionNoteEditor } from './ConnectionNoteEditor';
import { ConnectionNotesPanel } from './ConnectionNotesPanel';

const BASE = '/api/connector-notes/oauth%3AChatGPT';

const existing: ConnectorNote = {
  id: 'n1',
  actor: 'oauth:ChatGPT',
  title: 'note-1',
  text: 'Keep the plain test phrase',
  images: [],
  visibleToAi: true,
  aiCanDelete: true,
  readOnConnect: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function editor(note: ConnectorNote | null) {
  const onSave = vi.fn(async () => undefined);
  render(
    <ConnectionNoteEditor actor="oauth:ChatGPT" note={note} onSave={onSave} onCancel={vi.fn()} />,
  );
  return onSave;
}

test('a new note shows all three switches with the defaults and sends them on save', async () => {
  const user = userEvent.setup();
  const onSave = editor(null);
  const visible = screen.getByRole('switch', { name: 'Visible to AI' });
  const aiDelete = screen.getByRole('switch', { name: 'AI can delete' });
  const readOnConnect = screen.getByRole('switch', { name: 'Read on connect' });
  expect(visible).toBeChecked();
  expect(aiDelete).not.toBeChecked();
  expect(readOnConnect).not.toBeChecked();

  // Title and all three switches share the first row; nothing is left on a row below.
  const titleRow = screen.getByLabelText('Title').closest('.note-title-row');
  expect(titleRow).not.toBeNull();
  expect(titleRow).toContainElement(visible);
  expect(titleRow).toContainElement(aiDelete);
  expect(titleRow).toContainElement(readOnConnect);
  const switches = visible.closest('.note-title-switches');
  expect(switches).not.toBeNull();
  expect(switches).toContainElement(aiDelete);
  expect(switches).toContainElement(readOnConnect);
  expect(document.querySelector('.note-switch-row')).toBeNull();

  await user.type(screen.getByLabelText('Text'), 'plain words');
  await user.click(aiDelete);
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      text: 'plain words',
      visibleToAi: true,
      aiCanDelete: true,
      readOnConnect: false,
    }),
  );
});

test('turning Visible to AI off disables the two lower switches and saves the hidden state', async () => {
  const user = userEvent.setup();
  const onSave = editor(existing);
  const aiDelete = screen.getByRole('switch', { name: 'AI can delete' });
  const readOnConnect = screen.getByRole('switch', { name: 'Read on connect' });
  expect(aiDelete).toBeChecked();
  expect(aiDelete).toBeEnabled();
  await user.click(readOnConnect);
  await user.click(screen.getByRole('switch', { name: 'Visible to AI' }));
  expect(aiDelete).toBeDisabled();
  expect(readOnConnect).toBeDisabled();
  expect(aiDelete.closest('[title]')).toHaveAttribute(
    'title',
    "Hidden notes can't be read or deleted by AI",
  );
  expect(readOnConnect.closest('[title]')).toHaveAttribute(
    'title',
    "Hidden notes can't be read by AI",
  );
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      text: 'Keep the plain test phrase',
      title: 'note-1',
      keepImageIds: [],
      visibleToAi: false,
      readOnConnect: true,
    }),
  );
});

test('the notes table puts search, rows and pagination in one toolbar', async () => {
  installApiFixtures({ routes: { [BASE]: { actor: 'oauth:ChatGPT', notes: [existing] } } });
  render(
    <DialogProvider>
      <ConnectionNotesPanel actor="oauth:ChatGPT" />
    </DialogProvider>,
  );
  const search = await screen.findByRole('searchbox');
  const toolbar = search.closest('.dt-toolbar') as HTMLElement;
  expect(toolbar).not.toBeNull();
  expect(toolbar.closest('[data-table-id="connection-notes"]')).toHaveClass('dt-compact');
  expect(toolbar.querySelector('.dt-size')).not.toBeNull();
  expect(toolbar.querySelector('.dt-pagination')).not.toBeNull();
  expect(document.querySelector('.dt-footer')).toBeNull();
});

test('the sticky one-row toolbar style is scoped to the notes table', () => {
  // Vitest runs from apps/web-react; CSS imports are stubbed there, so read the file.
  const notesCss = readFileSync('src/styles/connection-notes.css', 'utf8');
  const css = notesCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /([^{}]+)\{([^}]*position:\s*sticky[^}]*)\}/.exec(css);
  expect(rule).not.toBeNull();
  expect(rule![1]!.trim()).toBe(
    ".connection-notes .data-table-host[data-table-id='connection-notes'] > .dt-toolbar",
  );
  expect(rule![2]).toMatch(/top:\s*0/);
  expect(rule![2]).toMatch(/background:\s*var\(--canvas\)/);
  expect(rule![2]).toMatch(/flex-wrap:\s*wrap/);
  expect(css.match(/position:\s*sticky/g)).toHaveLength(1);
});

test('the note title row wraps its switches under the title on narrow widths', () => {
  const notesCss = readFileSync('src/styles/connection-notes.css', 'utf8');
  const css = notesCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const row = /\.note-title-row\s*\{([^}]*)\}/.exec(css);
  expect(row?.[1]).toMatch(/flex-wrap:\s*wrap/);
  const switches = /\.note-title-switches\s*\{([^}]*)\}/.exec(css);
  expect(switches?.[1]).toMatch(/flex-wrap:\s*wrap/);
  expect(css).not.toMatch(/\.note-switch-row/);
});
