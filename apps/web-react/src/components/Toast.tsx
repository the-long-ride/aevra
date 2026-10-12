import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ToastTone = 'success' | 'error';

interface ToastState {
  message: string;
  tone: ToastTone;
  ariaLabel?: string | undefined;
}

export const TOAST_DISMISS_MS = 4000;

let sharedStack: HTMLDivElement | null = null;
let stackOwners = 0;

function acquireStack(): HTMLDivElement {
  if (!sharedStack) {
    sharedStack = document.createElement('div');
    sharedStack.className = 'toast-stack';
    document.body.append(sharedStack);
  }
  stackOwners++;
  return sharedStack;
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * Render `toast` once and call `success` / `error` from handlers. Each caller
 * owns its notice and dismiss timer; all notices share one bottom-right portal
 * stack. Showing a new message restarts that caller's timer.
 */
export function useToast(dismissMs = TOAST_DISMISS_MS) {
  const [state, setState] = useState<ToastState | null>(null);
  const [stack, setStack] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const target = acquireStack();
    setStack(target);
    return () => {
      stackOwners--;
      if (stackOwners === 0) {
        target.remove();
        sharedStack = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!state) return undefined;
    const timer = window.setTimeout(() => setState(null), dismissMs);
    return () => window.clearTimeout(timer);
  }, [state, dismissMs]);

  const success = useCallback(
    (message: string, ariaLabel?: string) => setState({ message, tone: 'success', ariaLabel }),
    [],
  );
  const error = useCallback(
    (cause: unknown, ariaLabel?: string) =>
      setState({ message: messageOf(cause), tone: 'error', ariaLabel }),
    [],
  );
  const clear = useCallback(() => setState(null), []);

  const toast: ReactNode =
    state && stack
      ? createPortal(
          <div
            className={`toast ${state.tone}`}
            role={state.tone === 'error' ? 'alert' : 'status'}
            aria-label={state.ariaLabel}
          >
            {state.message}
          </div>,
          stack,
        )
      : null;

  return { toast, success, error, clear };
}
