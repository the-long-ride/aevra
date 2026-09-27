import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchableMultiSelect, type SearchOption } from './SearchableMultiSelect';

const options: SearchOption[] = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta', description: 'second choice' },
  { value: 'gamma', label: 'Gamma' },
];

const originalHeight = window.innerHeight;

function stubRect(rect: Partial<DOMRect>) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 200,
    height: 30,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
}

afterEach(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
});

function setup(props: Partial<Parameters<typeof SearchableMultiSelect>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <SearchableMultiSelect ariaLabel="Picker" options={options} onChange={onChange} {...props} />,
  );
  return { onChange, input: screen.getByRole('combobox', { name: 'Picker' }) };
}

describe('SearchableMultiSelect keyboard navigation', () => {
  it('wraps the active option in both directions and selects with Enter', () => {
    const { input, onChange } = setup();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: 'Beta second choice' })).toHaveClass('is-active');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveClass('is-active');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['alpha']);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ignores Enter with no query or active option, and Backspace removes the last chip', () => {
    const { input, onChange } = setup({ defaultValue: ['alpha', 'custom-id'] });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('placeholder', 'Add more…');
    expect(screen.getByRole('button', { name: 'Remove custom-id' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith(['alpha']);
    expect(screen.queryByRole('button', { name: 'Remove custom-id' })).toBeNull();
  });

  it('keeps a controlled value until the parent updates it', () => {
    const { input, onChange } = setup({ values: ['beta'] });
    fireEvent.change(input, { target: { value: 'GAMMA' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['beta', 'gamma']);
    expect(screen.queryByRole('button', { name: 'Remove Gamma' })).toBeNull();
  });
});

describe('SearchableMultiSelect menu', () => {
  it('toggles a selected option off from the menu', () => {
    const { input, onChange } = setup({ defaultValue: ['beta'] });
    fireEvent.focus(input);
    const beta = screen.getByRole('option', { name: /Beta/ });
    expect(beta).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(beta);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('offers to use an unmatched query as an id', () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: '  zeta  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Use .zeta. as ID/ }));
    expect(onChange).toHaveBeenLastCalledWith(['zeta']);
  });

  it('reports an empty option list', () => {
    render(<SearchableMultiSelect ariaLabel="Empty" options={[]} />);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Empty' }));
    expect(screen.getByText('No options available')).toBeInTheDocument();
  });

  it('opens above the control when there is more room above', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    stubRect({ top: 560, bottom: 590, left: 10 });
    const { input } = setup();
    fireEvent.focus(input);
    const menu = screen.getByRole('listbox');
    expect(menu.style.top).toBe('auto');
    expect(menu.style.bottom).toBe('43px');
    expect(menu.style.maxHeight).toBe('240px');
  });

  it('repositions on resize and scroll while open', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    stubRect({ top: 10, bottom: 40, left: 10 });
    const { input } = setup();
    fireEvent.focus(input);
    const menu = screen.getByRole('listbox');
    expect(menu.style.top).toBe('43px');
    expect(menu.style.bottom).toBe('auto');

    stubRect({ top: 100, bottom: 130, left: 10 });
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('listbox').style.top).toBe('133px');
    stubRect({ top: 200, bottom: 230, left: 10 });
    fireEvent.scroll(window);
    expect(screen.getByRole('listbox').style.top).toBe('233px');
  });
});
