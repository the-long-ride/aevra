import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useModalLayer } from './modal-layer';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'details > summary:first-of-type:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ManagementModal({
  open,
  title,
  onClose,
  children,
  className,
  surfaceId,
  closeSurfaceId,
  closeIcon = false,
  footer,
}: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  className?: string;
  surfaceId?: string;
  closeSurfaceId?: string;
  /** Render the close control as an "x" icon button (accessible name stays "Close"). */
  closeIcon?: boolean;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const { ref: layerRef, isTop } = useModalLayer();
  const previousFocus = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // A layer stacked above this one (e.g. a confirm) owns the keyboard.
      if (!isTop()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => {
          if (element.closest('[hidden], [inert]')) return false;
          for (
            let ancestor = element.parentElement;
            ancestor && ancestor !== dialog;
            ancestor = ancestor.parentElement
          ) {
            if (
              ancestor.tagName === 'DETAILS' &&
              !ancestor.hasAttribute('open') &&
              !ancestor.querySelector(':scope > summary')?.contains(element)
            )
              return false;
          }
          return true;
        },
      );
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialog)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus();
    };
  }, [isTop, open]);

  if (!open) return null;

  return (
    <div
      ref={layerRef}
      className="modal-backdrop management-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`modal management-modal${className ? ` ${className}` : ''}`}
        data-surface-id={surfaceId}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            data-surface-id={closeSurfaceId}
            aria-label={closeIcon ? 'Close' : undefined}
          >
            {closeIcon ? '\u00d7' : 'Close'}
          </button>
        </div>
        <div className="modal-body management-modal-body">{children}</div>
        {footer ? <footer className="modal-foot management-modal-foot">{footer}</footer> : null}
      </section>
    </div>
  );
}
