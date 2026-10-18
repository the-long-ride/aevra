import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ConnectionNoteEditor } from './ConnectionNoteEditor';

const ZONE = 'Drop images or click to add';

function file(name: string, type: string, size = 8) {
  return new File([new Uint8Array(size)], name, { type });
}

function filesDrag(files: File[]) {
  return { dataTransfer: { types: ['Files'], files } };
}

function renderEditor(onSave = vi.fn(async () => undefined)) {
  render(
    <ConnectionNoteEditor actor="oauth:ChatGPT" note={null} onSave={onSave} onCancel={vi.fn()} />,
  );
  return { onSave, form: screen.getByRole('form', { name: 'New note' }) };
}

interface CanvasSizes {
  png: number;
  jpeg: number;
}

function mockCanvas(sizes: CanvasSizes) {
  const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
    const size = type === 'image/jpeg' ? sizes.jpeg : sizes.png;
    callback(new Blob([new Uint8Array(size)], { type: type ?? 'image/png' }));
  });
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 4, height: 3, close })),
  );
  return { context, close };
}

test('the drop zone is a button on the same row as Cancel and Save note', () => {
  renderEditor();
  const zone = screen.getByRole('button', { name: ZONE });
  expect(zone).toHaveTextContent(ZONE);
  const row = screen.getByRole('button', { name: 'Save note' }).closest('.note-editor-footer');
  expect(row).not.toBeNull();
  expect(zone.closest('.note-editor-footer')).toBe(row);
  expect(screen.getByRole('button', { name: 'Cancel' }).closest('.note-editor-footer')).toBe(row);
  const input = screen.getByLabelText('Add images');
  expect(input).toHaveAttribute('accept', 'image/*');
  expect(input).toHaveAttribute('multiple');
});

test('clicking or pressing Enter or Space on the drop zone opens the file picker', async () => {
  const user = userEvent.setup();
  renderEditor();
  const open = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
  const zone = screen.getByRole('button', { name: ZONE });
  await user.click(zone);
  expect(open).toHaveBeenCalledTimes(1);
  zone.focus();
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(open).toHaveBeenCalledTimes(3);
});

test('dropping image files anywhere on the editor adds them', async () => {
  const { form } = renderEditor();
  const notPrevented = fireEvent.drop(
    screen.getByLabelText('Title'),
    filesDrag([file('a.png', 'image/png')]),
  );
  expect(notPrevented).toBe(false);
  expect(await screen.findByRole('img', { name: 'a.png' })).toBeInTheDocument();
  fireEvent.drop(form, filesDrag([file('b.webp', 'image/webp')]));
  expect(await screen.findByRole('img', { name: 'b.webp' })).toBeInTheDocument();
});

test('dragging files over the editor highlights it until the drag really leaves', () => {
  const { form } = renderEditor();
  const text = screen.getByLabelText('Text');
  expect(screen.queryByText('Drop images to add')).toBeNull();
  fireEvent.dragEnter(form, filesDrag([]));
  expect(screen.getByText('Drop images to add')).toBeInTheDocument();
  expect(form).toHaveAttribute('data-dragging', 'true');
  fireEvent.dragEnter(text, filesDrag([]));
  fireEvent.dragLeave(form, filesDrag([]));
  expect(screen.getByText('Drop images to add')).toBeInTheDocument();
  fireEvent.dragLeave(text, filesDrag([]));
  expect(screen.queryByText('Drop images to add')).toBeNull();
  expect(form).not.toHaveAttribute('data-dragging');

  fireEvent.dragEnter(form, filesDrag([]));
  fireEvent.drop(form, filesDrag([file('c.png', 'image/png')]));
  expect(screen.queryByText('Drop images to add')).toBeNull();
});

test('drags without files are ignored', () => {
  const { form } = renderEditor();
  fireEvent.dragEnter(form, { dataTransfer: { types: ['text/plain'], files: [] } });
  expect(screen.queryByText('Drop images to add')).toBeNull();
  const notPrevented = fireEvent.drop(form, { dataTransfer: { types: ['text/plain'], files: [] } });
  expect(notPrevented).toBe(true);
  expect(screen.queryByRole('img')).toBeNull();
});

test('dropping a non-image file shows an error', async () => {
  const { form } = renderEditor();
  fireEvent.drop(form, filesDrag([file('notes.txt', 'text/plain')]));
  expect(await screen.findByRole('alert')).toHaveTextContent('Only image files can be added.');
});

test.each([
  ['logo.bmp', 'image/bmp', 'logo.png'],
  ['icon.svg', 'image/svg+xml', 'icon.png'],
  ['photo.v2.avif', 'image/avif', 'photo.v2.png'],
])('%s is converted to PNG before upload', async (name, type, expected) => {
  const user = userEvent.setup();
  const { close } = mockCanvas({ png: 100, jpeg: 50 });
  const { form, onSave } = renderEditor();
  fireEvent.drop(form, filesDrag([file(name, type)]));
  const thumb = await screen.findByRole('img', { name: expected });
  expect(thumb.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  expect(close).toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]).toEqual([
    {
      text: '',
      visibleToAi: true,
      aiCanDelete: false,
      readOnConnect: false,
      addImages: [{ name: expected, dataBase64: thumb.getAttribute('src') }],
    },
  ]);
});

test('a converted PNG over 2 MiB falls back to JPEG, and errors when still too big', async () => {
  const over = 2 * 1024 * 1024 + 1;
  mockCanvas({ png: over, jpeg: 1000 });
  const { form } = renderEditor();
  fireEvent.drop(form, filesDrag([file('big.tiff', 'image/tiff', over * 2)]));
  const thumb = await screen.findByRole('img', { name: 'big.jpg' });
  expect(thumb.getAttribute('src')).toMatch(/^data:image\/jpeg;base64,/);

  vi.restoreAllMocks();
  mockCanvas({ png: over, jpeg: over });
  fireEvent.drop(form, filesDrag([file('huge.bmp', 'image/bmp')]));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Each image must be 2 MiB or smaller.',
  );
});

test('an image the browser cannot decode shows a readable message', async () => {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      throw new Error('nope');
    }),
  );
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:test'),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal(
    'Image',
    class {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    },
  );
  const { form } = renderEditor();
  fireEvent.drop(form, filesDrag([file('odd.heic', 'image/heic')]));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Can't read odd.heic in this browser. Try PNG, JPEG, GIF or WebP.",
  );
  expect(screen.queryByRole('img')).toBeNull();
});

test('the <img> fallback decodes when createImageBitmap is missing and revokes its URL', async () => {
  mockCanvas({ png: 100, jpeg: 50 });
  vi.stubGlobal('createImageBitmap', undefined);
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: revoke });
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 2;
      naturalHeight = 2;
      onload: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  const { form } = renderEditor();
  fireEvent.drop(form, filesDrag([file('pic.bmp', 'image/bmp')]));
  expect(await screen.findByRole('img', { name: 'pic.png' })).toBeInTheDocument();
  expect(revoke).toHaveBeenCalledWith('blob:test');
});
