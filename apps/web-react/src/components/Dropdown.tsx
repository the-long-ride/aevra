import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

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

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'above' | 'below';
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
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = value ?? internalValue;
  const selected = options.find((option) => option.value === selectedValue) ?? options[0];

  const positionMenu = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 3;
    const viewportPadding = 8;
    const preferredHeight = 280;
    const below = window.innerHeight - rect.bottom - gap - viewportPadding;
    const above = rect.top - gap - viewportPadding;
    const placement = below >= Math.min(preferredHeight, above) ? 'below' : 'above';
    const available = placement === 'below' ? below : above;
    setMenuPosition({
      top:
        placement === 'below'
          ? rect.bottom + gap
          : Math.max(viewportPadding, rect.top - gap - Math.min(preferredHeight, available)),
      left: Math.max(
        viewportPadding,
        Math.min(rect.left, window.innerWidth - rect.width - viewportPadding),
      ),
      width: Math.min(rect.width, window.innerWidth - viewportPadding * 2),
      maxHeight: Math.max(80, Math.min(preferredHeight, available)),
      placement,
    });
  };

  useLayoutEffect(() => {
    if (open) positionMenu();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onViewportChange = () => positionMenu();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  const selectValue = (nextValue: string) => {
    if (value === undefined) setInternalValue(nextValue);
    onChange?.(nextValue);
    setOpen(false);
  };

  const menu =
    open && menuPosition && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            className="dropdown-menu dropdown-menu-portal"
            data-placement={menuPosition.placement}
            role="listbox"
            aria-labelledby={id}
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
              width: menuPosition.width,
              maxHeight: menuPosition.maxHeight,
            }}
          >
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
          </div>,
          document.body,
        )
      : null;

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
      {menu}
    </div>
  );
}
