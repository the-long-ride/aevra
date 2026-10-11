import { useCallback, useEffect, useState, type ReactNode } from 'react';

export type ToastTone = 'success' | 'error';

interface ToastState {
  message: string;
  tone: ToastTone;
  ariaLabel?: string | undefined;
}

export const TOAST_DISMISS_MS = 4000;

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * Local owner of the bottom-right `.toast-stack` notice. Render `toast` once in
 * the component's JSX and call `success` / `error` from handlers. Showing a new
 * message restarts the dismiss timer.
 */
export function useToast(dismissMs = TOAST_DISMISS_MS) {
  const [state, setState] = useState<ToastState | null>(null);

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

  const toast: ReactNode = state ? (
    <div className="toast-stack">
      <div
        className={`toast ${state.tone}`}
        role={state.tone === 'error' ? 'alert' : 'status'}
        aria-label={state.ariaLabel}
      >
        {state.message}
      </div>
    </div>
  ) : null;

  return { toast, success, error, clear };
}
