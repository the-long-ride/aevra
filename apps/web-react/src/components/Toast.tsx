import { useCallback, useEffect, useRef, type ReactNode } from 'react';

export type ToastTone = 'success' | 'error';

export const TOAST_DISMISS_MS = 4000;
const TOAST_PREFIX = '// ';

/** The //  prefix is drawn by .toast::before; a message that brings its own is not doubled. */
function withoutPrefix(message: string): string {
  return message.startsWith(TOAST_PREFIX) ? message.slice(TOAST_PREFIX.length) : message;
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

interface ActiveToastRecord {
  id: string;
  callerId: string;
  element: HTMLDivElement;
  dismissTimer: ReturnType<typeof setTimeout>;
  exitTimer?: ReturnType<typeof setTimeout>;
}

let sharedStack: HTMLDivElement | null = null;
let stackOwners = 0;
let activeToasts: ActiveToastRecord[] = [];
let idCounter = 0;

function acquireStack(): HTMLDivElement {
  if (!sharedStack) {
    sharedStack = document.createElement('div');
    sharedStack.className = 'toast-stack';
    document.body.append(sharedStack);
  }
  return sharedStack;
}

function removeToastRecord(record: ActiveToastRecord, animate = false) {
  clearTimeout(record.dismissTimer);
  if (record.exitTimer) clearTimeout(record.exitTimer);

  const cleanup = () => {
    record.element.remove();
    activeToasts = activeToasts.filter((t) => t.id !== record.id);
    if (activeToasts.length === 0 && stackOwners === 0 && sharedStack) {
      sharedStack.remove();
      sharedStack = null;
    }
  };

  if (animate) {
    record.element.classList.add('toast-exit');
    setTimeout(cleanup, 180);
  } else {
    cleanup();
  }
}

function scheduleTimers(record: ActiveToastRecord, dismissMs: number) {
  const exitDuration = Math.min(180, Math.max(40, Math.floor(dismissMs * 0.15)));
  const exitStart = Math.max(0, dismissMs - exitDuration);

  if (exitStart > 0) {
    record.exitTimer = setTimeout(() => {
      record.element.classList.add('toast-exit');
    }, exitStart);
  }

  record.dismissTimer = setTimeout(() => {
    removeToastRecord(record, false);
  }, dismissMs);
}

/**
 * Render `toast` and call `success` / `error` from handlers.
 * Toasts are rendered independently into the bottom-right stack with dedicated
 * animations, unaffected by tab switching or caller unmounting.
 */
export function useToast(dismissMs = TOAST_DISMISS_MS) {
  const callerIdRef = useRef<string | undefined>(undefined);
  if (!callerIdRef.current) {
    callerIdRef.current = `caller-${++idCounter}`;
  }
  const callerId = callerIdRef.current;

  useEffect(() => {
    stackOwners++;
    acquireStack();
    return () => {
      stackOwners--;
      // Active toasts stay alive with their own timers across unmounts,
      // tab switches, and modal closes. Clean up stack only if zero owners
      // and no active toasts remain.
      if (stackOwners === 0) {
        for (const t of activeToasts) {
          clearTimeout(t.dismissTimer);
          if (t.exitTimer) clearTimeout(t.exitTimer);
          t.element.remove();
        }
        activeToasts = [];
        if (sharedStack) {
          sharedStack.remove();
          sharedStack = null;
        }
      }
    };
  }, []);

  const postToast = useCallback(
    (message: string, tone: ToastTone, ariaLabel?: string) => {
      const stack = acquireStack();
      const existing = activeToasts.find((t) => t.callerId === callerId);

      if (existing) {
        clearTimeout(existing.dismissTimer);
        if (existing.exitTimer) clearTimeout(existing.exitTimer);

        existing.element.className = `toast ${tone}`;
        existing.element.setAttribute('role', tone === 'error' ? 'alert' : 'status');
        if (ariaLabel) {
          existing.element.setAttribute('aria-label', ariaLabel);
        } else {
          existing.element.removeAttribute('aria-label');
        }
        existing.element.textContent = withoutPrefix(message);

        // Re-trigger entrance animation
        existing.element.classList.remove('toast-exit');
        existing.element.classList.remove('toast-in');
        void existing.element.offsetWidth;
        existing.element.classList.add('toast-in');

        scheduleTimers(existing, dismissMs);
        return;
      }

      const id = `toast-${++idCounter}`;
      const el = document.createElement('div');
      el.className = `toast ${tone} toast-in`;
      el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
      if (ariaLabel) {
        el.setAttribute('aria-label', ariaLabel);
      }
      el.textContent = withoutPrefix(message);
      el.title = 'Click to dismiss';

      const record: ActiveToastRecord = {
        id,
        callerId,
        element: el,
        dismissTimer: 0 as any,
      };

      el.addEventListener('click', () => {
        removeToastRecord(record, true);
      });

      stack.appendChild(el);
      activeToasts.push(record);
      scheduleTimers(record, dismissMs);
    },
    [callerId, dismissMs],
  );

  const success = useCallback(
    (message: string, ariaLabel?: string) => postToast(message, 'success', ariaLabel),
    [postToast],
  );

  const error = useCallback(
    (cause: unknown, ariaLabel?: string) => postToast(messageOf(cause), 'error', ariaLabel),
    [postToast],
  );

  const clear = useCallback(() => {
    const existing = activeToasts.find((t) => t.callerId === callerId);
    if (existing) {
      removeToastRecord(existing, false);
    }
  }, [callerId]);

  const toast: ReactNode = null;

  return { toast, success, error, clear };
}
