import { type ReactNode } from 'react';

export interface SwapOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  hint?: string;
  ariaLabel?: string;
}

export interface SwapControlProps<T extends string> {
  name: string;
  value: T;
  options: SwapOption<T>[];
  onChange(value: T): void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function SwapControl<T extends string>({
  name,
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  ariaLabel,
}: SwapControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`swap-control console-radio-group${className ? ` ${className}` : ''}`}
    >
      {options.map((opt) => {
        const checked = value === opt.value;
        const optDisabled = disabled || Boolean(opt.disabled);
        return (
          <label
            key={opt.value}
            className={`swap-option console-radio-option${checked ? ' active is-selected' : ''}${optDisabled ? ' disabled is-disabled' : ''}`}
            title={opt.hint}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={checked}
              disabled={optDisabled}
              aria-label={opt.ariaLabel}
              onChange={() => {
                if (!optDisabled) {
                  onChange(opt.value);
                }
              }}
              className="swap-radio-input"
            />
            <span className="swap-option-label">{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}
