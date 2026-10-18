import { useEffect } from 'react';
import { topModalLayer } from './modal-layer';

// Elements that already turn Enter into their own action (or a newline).
const NATIVE_ENTER =
  'a[href], button, select, textarea, summary, [contenteditable=""], [contenteditable="true"]';
const ENABLED_SUBMIT =
  'button[type="submit"]:not(:disabled), button:not([type]):not(:disabled), input[type="submit"]:not(:disabled)';

/**
 * Enter presses the primary button of the topmost open dialog.
 *
 * A dialog opts out with `data-enter-default="off"` (used for approval decisions,
 * which must never be granted by a stray key press). Enter inside a form input is
 * left to the browser's own submit, so a form is never submitted twice.
 */
export function useDialogEnterKey(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented || event.repeat || event.isComposing)
        return;
      if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;

      // Only the top modal layer is interactive; dialogs under it are inert.
      const scope = topModalLayer() ?? document;
      const dialogs = scope.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      const dialog = dialogs[dialogs.length - 1];
      if (!dialog || dialog.dataset.enterDefault === 'off') return;

      const target = event.target instanceof Element ? event.target : null;
      if (target && target !== document.body && !dialog.contains(target)) return;
      if (target?.closest(NATIVE_ENTER)) return;
      if (target instanceof HTMLInputElement && target.form?.querySelector(ENABLED_SUBMIT)) return;

      const primary = dialog.querySelectorAll<HTMLButtonElement>('button.primary:not(:disabled)');
      const button = primary[primary.length - 1];
      if (!button) return;
      event.preventDefault();
      button.click();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
