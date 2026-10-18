import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDialogEnterKey } from './dialog-enter-key';

function Host({ children }: { children: React.ReactNode }) {
  useDialogEnterKey();
  return <>{children}</>;
}

function dialog(extra: Record<string, string> = {}, body: React.ReactNode = null) {
  return (
    <div role="dialog" aria-modal="true" aria-label="d" {...extra}>
      {body}
    </div>
  );
}

const enter = (target: Element | Document = document.body, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key: 'Enter', ...init });

afterEach(() => vi.restoreAllMocks());

it('clicks the primary button of an open dialog when nothing is focused', () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <Host>
      {dialog(
        {},
        <>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={onSave}>
            Save
          </button>
        </>,
      )}
    </Host>,
  );
  enter();
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
});

it('clicks the primary button from a text input that has no form', () => {
  const onSave = vi.fn();
  render(
    <Host>
      {dialog(
        {},
        <>
          <input aria-label="name" />
          <button className="primary" onClick={onSave}>
            Save
          </button>
        </>,
      )}
    </Host>,
  );
  enter(screen.getByLabelText('name'));
  expect(onSave).toHaveBeenCalledTimes(1);
});

it('leaves Enter in a form input to the native submit', () => {
  const onSave = vi.fn();
  render(
    <Host>
      {dialog(
        {},
        <form>
          <input aria-label="name" />
          <button className="primary" onClick={onSave}>
            Save
          </button>
        </form>,
      )}
    </Host>,
  );
  enter(screen.getByLabelText('name'));
  expect(onSave).not.toHaveBeenCalled();
});

it('never acts from a textarea or a focused button, link or select', () => {
  const onSave = vi.fn();
  render(
    <Host>
      {dialog(
        {},
        <>
          <textarea aria-label="note" />
          <button>Other</button>
          <a href="#x">link</a>
          <select aria-label="pick" />
          <button className="primary" onClick={onSave}>
            Save
          </button>
        </>,
      )}
    </Host>,
  );
  for (const el of [
    screen.getByLabelText('note'),
    screen.getByText('Other'),
    screen.getByText('link'),
    screen.getByLabelText('pick'),
  ]) {
    enter(el);
  }
  expect(onSave).not.toHaveBeenCalled();
});

it('ignores a disabled primary button, repeats, composition and modifier keys', () => {
  const onSave = vi.fn();
  const { rerender } = render(
    <Host>
      {dialog(
        {},
        <button className="primary" disabled onClick={onSave}>
          Save
        </button>,
      )}
    </Host>,
  );
  enter();
  rerender(
    <Host>
      {dialog(
        {},
        <button className="primary" onClick={onSave}>
          Save
        </button>,
      )}
    </Host>,
  );
  enter(document.body, { repeat: true });
  enter(document.body, { isComposing: true });
  enter(document.body, { shiftKey: true });
  enter(document.body, { ctrlKey: true });
  expect(onSave).not.toHaveBeenCalled();
});

it('does nothing when no dialog is open or the dialog opts out', () => {
  const onSave = vi.fn();
  const { rerender } = render(
    <Host>
      <button className="primary" onClick={onSave}>
        Page button
      </button>
    </Host>,
  );
  enter();
  rerender(
    <Host>
      {dialog(
        { 'data-enter-default': 'off' },
        <button className="primary" onClick={onSave}>
          Allow
        </button>,
      )}
    </Host>,
  );
  enter();
  expect(onSave).not.toHaveBeenCalled();
});

it('acts only on the topmost dialog and ignores keys from the page behind it', () => {
  const lower = vi.fn();
  const upper = vi.fn();
  render(
    <Host>
      <button>Behind</button>
      {dialog(
        {},
        <button className="primary" onClick={lower}>
          Lower
        </button>,
      )}
      {dialog(
        {},
        <button className="primary" onClick={upper}>
          Upper
        </button>,
      )}
    </Host>,
  );
  enter(screen.getByText('Behind'));
  enter();
  expect(lower).not.toHaveBeenCalled();
  expect(upper).toHaveBeenCalledTimes(1);
});

it('picks the last enabled primary button when a dialog offers several', () => {
  const preview = vi.fn();
  const install = vi.fn();
  render(
    <Host>
      {dialog(
        {},
        <>
          <button className="primary" onClick={preview}>
            Preview
          </button>
          <button className="primary" onClick={install}>
            Install
          </button>
        </>,
      )}
    </Host>,
  );
  enter();
  expect(install).toHaveBeenCalledTimes(1);
  expect(preview).not.toHaveBeenCalled();
});
