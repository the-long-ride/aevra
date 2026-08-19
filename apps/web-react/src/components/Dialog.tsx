import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type DialogTone = 'default' | 'primary' | 'danger';

export interface DialogAction {
  id: string;
  label: string;
  tone?: DialogTone;
}

interface DialogInput {
  label: string;
  initialValue?: string;
  placeholder?: string;
  required?: boolean;
  submitId: string;
}

interface DialogRequest {
  title: string;
  message?: ReactNode;
  actions: DialogAction[];
  cancelId?: string;
  input?: DialogInput;
}

interface DialogResolution {
  actionId: string | null;
  value?: string;
}

interface MessageOptions {
  title: string;
  message?: ReactNode;
  actionLabel?: string;
}

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: DialogTone;
}

interface ChooseOptions {
  title: string;
  message?: ReactNode;
  actions: DialogAction[];
  cancelId?: string;
}

interface PromptOptions {
  title: string;
  message?: ReactNode;
  label: string;
  initialValue?: string;
  placeholder?: string;
  required?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: DialogTone;
}

export interface DialogApi {
  message(options: MessageOptions): Promise<void>;
  confirm(options: ConfirmOptions): Promise<boolean>;
  choose(options: ChooseOptions): Promise<string | null>;
  prompt(options: PromptOptions): Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

function actionClass(tone: DialogTone | undefined) {
  if (tone === 'primary') return 'primary';
  if (tone === 'danger') return 'danger-button';
  return undefined;
}

function CommonDialog({
  request,
  onResolve,
}: {
  request: DialogRequest;
  onResolve(result: DialogResolution): void;
}) {
  const titleId = useId();
  const [value, setValue] = useState(request.input?.initialValue ?? '');

  useEffect(() => {
    setValue(request.input?.initialValue ?? '');
  }, [request]);

  const cancel = useCallback(() => {
    onResolve({ actionId: request.cancelId ?? null, value });
  }, [onResolve, request.cancelId, value]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancel]);

  const submitAction = request.input
    ? request.actions.find((action) => action.id === request.input?.submitId)
    : undefined;

  return (
    <div
      className="modal-backdrop dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) cancel();
      }}
    >
      <form
        className="modal common-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitAction) return;
          onResolve({ actionId: submitAction.id, value });
        }}
      >
        <div className="modal-head">
          <h2 id={titleId}>{request.title}</h2>
        </div>
        <div className="modal-body dialog-body">
          {request.message ? <div className="dialog-message">{request.message}</div> : null}
          {request.input ? (
            <label className="field dialog-field">
              <span>{request.input.label}</span>
              <input
                autoFocus
                value={value}
                placeholder={request.input.placeholder}
                required={request.input.required}
                onChange={(event) => setValue(event.currentTarget.value)}
              />
            </label>
          ) : null}
        </div>
        <div className="modal-foot dialog-actions">
          {request.actions.map((action, index) => {
            const submit = request.input?.submitId === action.id;
            return (
              <button
                key={action.id}
                type={submit ? 'submit' : 'button'}
                className={actionClass(action.tone)}
                autoFocus={!request.input && (action.tone === 'primary' || index === 0)}
                onClick={
                  submit ? undefined : () => onResolve({ actionId: action.id, value })
                }
              >
                {action.label}
              </button>
            );
          })}
        </div>
      </form>
    </div>
  );
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<DialogRequest | null>(null);
  const resolver = useRef<((result: DialogResolution) => void) | null>(null);

  const open = useCallback((request: DialogRequest) => {
    return new Promise<DialogResolution>((resolve) => {
      resolver.current?.({ actionId: null });
      resolver.current = resolve;
      setActive(request);
    });
  }, []);

  const resolve = useCallback((result: DialogResolution) => {
    const current = resolver.current;
    resolver.current = null;
    setActive(null);
    current?.(result);
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      async message(options) {
        await open({
          title: options.title,
          message: options.message,
          cancelId: 'ok',
          actions: [{ id: 'ok', label: options.actionLabel ?? 'OK', tone: 'primary' }],
        });
      },
      async confirm(options) {
        const result = await open({
          title: options.title,
          message: options.message,
          cancelId: 'cancel',
          actions: [
            { id: 'cancel', label: options.cancelLabel ?? 'Cancel' },
            {
              id: 'confirm',
              label: options.confirmLabel ?? 'Confirm',
              tone: options.confirmTone ?? 'primary',
            },
          ],
        });
        return result.actionId === 'confirm';
      },
      async choose(options) {
        const result = await open({
          title: options.title,
          message: options.message,
          actions: options.actions,
          cancelId: options.cancelId,
        });
        if (!result.actionId || result.actionId === options.cancelId) return null;
        return result.actionId;
      },
      async prompt(options) {
        const result = await open({
          title: options.title,
          message: options.message,
          cancelId: 'cancel',
          actions: [
            { id: 'cancel', label: options.cancelLabel ?? 'Cancel' },
            {
              id: 'confirm',
              label: options.confirmLabel ?? 'OK',
              tone: options.confirmTone ?? 'primary',
            },
          ],
          input: {
            label: options.label,
            initialValue: options.initialValue,
            placeholder: options.placeholder,
            required: options.required,
            submitId: 'confirm',
          },
        });
        return result.actionId === 'confirm' ? (result.value ?? '') : null;
      },
    }),
    [open],
  );

  return (
    <DialogContext.Provider value={api}>
      {children}
      {active ? <CommonDialog request={active} onResolve={resolve} /> : null}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const value = useContext(DialogContext);
  if (!value) throw new Error('useDialog must be used inside DialogProvider');
  return value;
}
