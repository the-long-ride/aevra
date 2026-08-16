import { useState, type InputHTMLAttributes, type ReactNode } from 'react';

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'role' | 'children'
> {
  label: ReactNode;
  containerClassName?: string;
}

export function Switch({
  label,
  containerClassName = '',
  checked,
  defaultChecked = false,
  onChange,
  disabled,
  ...inputProps
}: SwitchProps) {
  const [uncontrolledChecked, setUncontrolledChecked] = useState(Boolean(defaultChecked));
  const currentChecked = checked === undefined ? uncontrolledChecked : Boolean(checked);

  return (
    <label className={`switch-control ${containerClassName}`.trim()}>
      <input
        {...inputProps}
        type="checkbox"
        role="switch"
        disabled={disabled}
        checked={checked}
        defaultChecked={checked === undefined ? defaultChecked : undefined}
        aria-checked={currentChecked}
        onChange={(event) => {
          if (checked === undefined) setUncontrolledChecked(event.currentTarget.checked);
          onChange?.(event);
        }}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </label>
  );
}
