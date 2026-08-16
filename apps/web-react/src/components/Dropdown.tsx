import { useEffect, useId, useRef, useState } from 'react';

export interface DropdownOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface DropdownProps {
  options: readonly DropdownOption[];
  value?: string;
  defaultValue?: string;
  onChange?(value: string): void;
  name?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function Dropdown({
  options,
  value,
  defaultValue = '',
  onChange,
  name,
  disabled = false,
  ariaLabel,
  className = '',
}: DropdownProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = value ?? internalValue;
  const selected = options.find((option) => option.value === selectedValue) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selectValue = (nextValue: string) => {
    if (value === undefined) setInternalValue(nextValue);
    onChange?.(nextValue);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`dropdown ${className}`.trim()}>
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
      <button
        id={id}
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="dropdown-value">{selected?.label ?? ''}</span>
        <span className="dropdown-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="dropdown-menu" role="listbox" aria-labelledby={id}>
          {options.map((option) => {
            const active = option.value === selectedValue;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                disabled={option.disabled}
                className={`dropdown-option${active ? ' is-active' : ''}`}
                onClick={() => selectValue(option.value)}
              >
                <span className="dropdown-option-label">{option.label}</span>
                {active ? (
                  <svg
                    className="dropdown-option-marker"
                    data-testid="dropdown-selected-marker"
                    viewBox="0 0 12 8"
                    shapeRendering="crispEdges"
                    aria-hidden="true"
                  >
                    <path
                      d="M11 0H8V1H6V2H4V3H1V5H4V6H6V7H8V8H11V6H9V5H7V3H9V2H11Z"
                      fill="currentColor"
                    />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
