import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

export interface SearchOption {
  value: string;
  label: string;
  description?: string;
}

export interface SearchableMultiSelectProps {
  id?: string;
  name?: string;
  ariaLabel?: string;
  placeholder?: string;
  options: readonly SearchOption[];
  values?: readonly string[];
  defaultValue?: readonly string[];
  onChange?(values: string[]): void;
  disabled?: boolean;
  className?: string;
}

interface MenuPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'above' | 'below';
}

function resolveItems(items: string[], options: readonly SearchOption[]): string[] {
  return items.map((item) => {
    const trimmed = item.trim();
    const match = options.find(
      (opt) =>
        opt.label.toLowerCase() === trimmed.toLowerCase() ||
        opt.value.toLowerCase() === trimmed.toLowerCase(),
    );
    return match ? match.value : trimmed;
  });
}

export function SearchableMultiSelect({
  id: explicitId,
  name,
  ariaLabel,
  placeholder = 'Search by name or enter ID…',
  options,
  values,
  defaultValue = [],
  onChange,
  disabled = false,
  className = '',
}: SearchableMultiSelectProps) {
  const generatedId = useId();
  const inputId = explicitId ?? generatedId;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [internalValues, setInternalValues] = useState<string[]>([...defaultValue]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const currentValues = values ?? internalValues;

  const updateValues = (next: string[]) => {
    if (values === undefined) {
      setInternalValues(next);
    }
    onChange?.(next);
  };

  const addValue = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    const resolved = resolveItems([trimmed], options)[0]!;
    if (!currentValues.includes(resolved)) {
      updateValues([...currentValues, resolved]);
    }
    setQuery('');
    setActiveIndex(-1);
    setOpen(false);
  };

  const removeValue = (val: string) => {
    updateValues(currentValues.filter((item) => item !== val));
  };

  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => {
        return (
          option.label.toLowerCase().includes(normalizedQuery) ||
          option.value.toLowerCase().includes(normalizedQuery) ||
          Boolean(option.description?.toLowerCase().includes(normalizedQuery))
        );
      })
    : options;

  const positionMenu = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 3;
    const viewportPadding = 8;
    const preferredHeight = 240;
    const below = window.innerHeight - rect.bottom - gap - viewportPadding;
    const above = rect.top - gap - viewportPadding;
    const estimatedHeight = Math.min(
      preferredHeight,
      Math.max(80, (filteredOptions.length || 1) * 40 + 16),
    );
    const placement = below >= estimatedHeight || below >= above ? 'below' : 'above';
    const available = placement === 'below' ? below : above;
    setMenuPosition({
      top: placement === 'below' ? rect.bottom + gap : undefined,
      bottom:
        placement === 'above'
          ? Math.max(viewportPadding, window.innerHeight - rect.top + gap)
          : undefined,
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
  }, [open, filteredOptions.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => (prev + 1 >= filteredOptions.length ? 0 : prev + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => (prev <= 0 ? filteredOptions.length - 1 : prev - 1));
      return;
    }
    if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && activeIndex < filteredOptions.length) {
        event.preventDefault();
        addValue(filteredOptions[activeIndex].value);
        return;
      }
      if (query.trim()) {
        event.preventDefault();
        addValue(query);
        return;
      }
    }
    if (event.key === 'Backspace' && query === '' && currentValues.length > 0) {
      removeValue(currentValues[currentValues.length - 1]);
    }
  };

  // Resolve typed text if form is submitted without explicit selection
  const pendingItems = query
    ? resolveItems(
        query
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        options,
      )
    : [];
  const formValue = Array.from(new Set([...currentValues, ...pendingItems])).join(',');

  const menu =
    open && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            className="searchable-select-menu"
            role="listbox"
            tabIndex={-1}
            style={{
              top: menuPosition.top !== undefined ? `${menuPosition.top}px` : 'auto',
              bottom: menuPosition.bottom !== undefined ? `${menuPosition.bottom}px` : 'auto',
              left: `${menuPosition.left}px`,
              width: `${menuPosition.width}px`,
              maxHeight: `${menuPosition.maxHeight}px`,
            }}
          >
            {filteredOptions.length === 0 ? (
              <div className="searchable-select-empty">
                {query.trim() ? (
                  <button
                    type="button"
                    className="searchable-select-custom-btn"
                    onClick={() => addValue(query)}
                  >
                    Use &ldquo;{query.trim()}&rdquo; as ID
                  </button>
                ) : (
                  <span>No options available</span>
                )}
              </div>
            ) : (
              filteredOptions.map((option, idx) => {
                const isSelected = currentValues.includes(option.value);
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`searchable-select-option${isActive ? ' is-active' : ''}${
                      isSelected ? ' is-selected' : ''
                    }`}
                    onClick={() => {
                      if (isSelected) {
                        removeValue(option.value);
                      } else {
                        addValue(option.value);
                      }
                    }}
                  >
                    <div className="searchable-select-option-main">
                      <span className="searchable-select-option-label">{option.label}</span>
                      {option.description ? (
                        <span className="searchable-select-option-desc">{option.description}</span>
                      ) : null}
                    </div>
                    {isSelected ? (
                      <span className="searchable-select-option-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={`searchable-select ${className}`.trim()}
      onClick={() => inputRef.current?.focus()}
    >
      {name ? <input type="hidden" name={name} value={formValue} /> : null}
      <div className="searchable-select-control">
        {currentValues.map((val) => {
          const opt = options.find((o) => o.value === val);
          const displayLabel = opt ? opt.label : val;
          return (
            <span key={val} className="searchable-select-chip">
              <span className="searchable-select-chip-text" title={displayLabel}>
                {displayLabel}
              </span>
              <button
                type="button"
                className="searchable-select-chip-remove"
                aria-label={`Remove ${displayLabel}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeValue(val);
                }}
                disabled={disabled}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className="searchable-select-input"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          role="combobox"
          placeholder={currentValues.length === 0 ? placeholder : 'Add more…'}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {menu}
    </div>
  );
}
