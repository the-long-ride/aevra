import { readFileSync } from 'node:fs';
import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { DialogProvider, useDialog } from './Dialog';
import { ManagementModal } from './ManagementModal';
import { useModalLayer } from './modal-layer';
import { useToast } from './Toast';

function Layer({ name, active = true }: { name: string; active?: boolean }) {
  const { ref } = useModalLayer(active);
  return (
    <div ref={ref} className="modal-backdrop" data-testid={name}>
      <button type="button">{name} action</button>
    </div>
  );
}

function Page({ outer = false, inner = false }: { outer?: boolean; inner?: boolean }) {
  return (
    <>
      <main data-testid="page">
        <button type="button">Page action</button>
      </main>
      <aside inert data-testid="already-inert" />
      {outer ? <Layer name="outer" /> : null}
      {inner ? <Layer name="inner" /> : null}
    </>
  );
}

const inert = (testId: string) => screen.getByTestId(testId).closest('[inert]') !== null;

afterEach(() => {
  document.body.removeAttribute('style');
});

test('one open layer locks body scroll and makes the background inert', () => {
  document.body.style.overflow = 'clip';
  const { rerender } = render(<Page outer />);
  expect(document.body.style.overflow).toBe('hidden');
  expect(inert('page')).toBe(true);
  expect(inert('outer')).toBe(false);
  expect(screen.getByTestId('outer')).toHaveAttribute('data-modal-layer-top');

  rerender(<Page />);
  expect(document.body.style.overflow).toBe('clip');
  expect(inert('page')).toBe(false);
  expect(screen.getByTestId('already-inert')).toHaveAttribute('inert');
});

test('nested layers: closing the inner keeps the lock and frees the outer', () => {
  const { rerender } = render(<Page outer inner />);
  expect(inert('outer')).toBe(true);
  expect(inert('inner')).toBe(false);
  expect(inert('page')).toBe(true);
  expect(screen.getByTestId('outer')).not.toHaveAttribute('data-modal-layer-top');
  expect(screen.getByTestId('inner')).toHaveAttribute('data-modal-layer-top');
  expect(document.body).toHaveAttribute('data-modal-stacked');

  rerender(<Page outer />);
  expect(inert('outer')).toBe(false);
  expect(inert('page')).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  expect(screen.getByTestId('outer')).toHaveAttribute('data-modal-layer-top');
  expect(document.body).not.toHaveAttribute('data-modal-stacked');

  rerender(<Page />);
  expect(inert('page')).toBe(false);
  expect(document.body.style.overflow).toBe('');
  expect(document.querySelectorAll('[inert]')).toHaveLength(1);
});

test('an inactive layer does not lock, and StrictMode replay keeps one lock', () => {
  const { unmount } = render(
    <StrictMode>
      <main data-testid="page" />
      <Layer name="drawer" active={false} />
    </StrictMode>,
  );
  expect(document.body.style.overflow).toBe('');
  expect(inert('page')).toBe(false);
  unmount();

  const strict = render(
    <StrictMode>
      <main data-testid="page" />
      <Layer name="drawer" />
    </StrictMode>,
  );
  expect(document.body.style.overflow).toBe('hidden');
  expect(inert('page')).toBe(true);
  strict.unmount();
  expect(document.body.style.overflow).toBe('');
});

test('the scrollbar width is compensated so the page does not shift', () => {
  const root = document.documentElement;
  const original = Object.getOwnPropertyDescriptor(root, 'clientWidth');
  Object.defineProperty(root, 'clientWidth', { configurable: true, value: window.innerWidth - 15 });
  try {
    const { unmount } = render(<Page outer />);
    expect(document.body.style.paddingRight).toBe('15px');
    unmount();
    expect(document.body.style.paddingRight).toBe('');
  } finally {
    if (original) Object.defineProperty(root, 'clientWidth', original);
    else Reflect.deleteProperty(root, 'clientWidth');
  }
});

function Floating() {
  const { ref } = useModalLayer(true, { blocking: false });
  return (
    <div ref={ref} data-testid="floating">
      <button type="button">Card action</button>
    </div>
  );
}

function FloatingPage({
  before,
  outer,
  after,
}: {
  before?: boolean;
  outer?: boolean;
  after?: boolean;
}) {
  return (
    <>
      <main data-testid="page" />
      {before ? <Floating /> : null}
      {outer ? <Layer name="outer" /> : null}
      {after ? <Floating /> : null}
    </>
  );
}

test('a non-blocking layer never locks, and stays usable only above a blocking layer', () => {
  const { rerender } = render(<FloatingPage before />);
  expect(document.body.style.overflow).toBe('');
  expect(inert('page')).toBe(false);
  expect(screen.getByTestId('floating')).toHaveAttribute('data-modal-layer-top');

  rerender(<FloatingPage before outer />);
  expect(inert('floating')).toBe(true);
  expect(inert('page')).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');

  rerender(<FloatingPage outer />);
  rerender(<FloatingPage outer after />);
  expect(inert('floating')).toBe(false);
  expect(inert('outer')).toBe(false);
  expect(inert('page')).toBe(true);
  expect(screen.getByTestId('floating')).toHaveAttribute('data-modal-layer-top');

  rerender(<FloatingPage after />);
  expect(inert('page')).toBe(false);
  expect(document.body.style.overflow).toBe('');
});
function ToastButton() {
  const { toast, success } = useToast();
  return (
    <>
      <button type="button" onClick={() => success('Saved it')}>
        notify
      </button>
      {toast}
    </>
  );
}

test('toasts stay outside the inert background', () => {
  const { rerender } = render(
    <>
      <ToastButton />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'notify' }));
  rerender(
    <>
      <ToastButton />
      <Layer name="outer" />
    </>,
  );
  const stack = document.querySelector('.toast-stack');
  expect(stack).not.toBeNull();
  expect(stack).not.toHaveAttribute('inert');
  expect(screen.getByRole('status')).toHaveTextContent('Saved it');
});

function ModalWithConfirm({ onClose }: { onClose(): void }) {
  const dialog = useDialog();
  return (
    <ManagementModal open title="Outer modal" onClose={onClose}>
      <button type="button" onClick={() => void dialog.confirm({ title: 'Are you sure' })}>
        Ask
      </button>
    </ManagementModal>
  );
}

test('Escape closes only the top layer', async () => {
  let closed = 0;
  render(
    <DialogProvider>
      <ModalWithConfirm onClose={() => closed++} />
    </DialogProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  const confirm = await screen.findByRole('dialog', { name: 'Are you sure' });
  expect(confirm.closest('[inert]')).toBeNull();
  const outer = screen.getByRole('dialog', { name: 'Outer modal', hidden: true });
  expect(outer.closest('[inert]')).not.toBeNull();

  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Are you sure' })).toBeNull());
  expect(closed).toBe(0);
  expect(outer.closest('[inert]')).toBeNull();

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(closed).toBe(1);
});

function cssRules(file: string): Array<[string, string]> {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g), (match) => [match[1]!.trim(), match[2]!]);
}

test('modal scroll containers never chain scrolling to the page', () => {
  const rules = cssRules('src/styles/modal-layer.css');
  const contain = rules.filter(([, body]) => /overscroll-behavior:\s*contain/.test(body));
  const selectors = contain.flatMap(([selector]) => selector.split(',').map((s) => s.trim()));
  expect(selectors).toEqual(expect.arrayContaining(['.modal-backdrop', '.modal', '.modal-body']));
  expect(readFileSync('src/styles/index.css', 'utf8')).toContain(
    "@import url('./modal-layer.css');",
  );
});

test('the top layer is raised above other layers but stays under toasts', () => {
  const rules = cssRules('src/styles/modal-layer.css');
  const top = rules.find(([selector]) => selector.includes('[data-modal-layer-top]'));
  expect(top).toBeDefined();
  const zIndex = Number(/z-index:\s*(\d+)/.exec(top![1])?.[1]);
  expect(zIndex).toBeGreaterThan(100);
  expect(zIndex).toBeLessThan(200);
  const menu = rules.find(([selector]) => selector.includes('.dropdown-menu-portal'));
  const menuZ = Number(/z-index:\s*(\d+)/.exec(menu?.[1] ?? '')?.[1]);
  expect(menuZ).toBeGreaterThan(zIndex);
  expect(menuZ).toBeLessThan(200);
});
