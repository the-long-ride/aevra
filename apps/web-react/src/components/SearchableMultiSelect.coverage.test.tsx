import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchableMultiSelect } from './SearchableMultiSelect';

describe('SearchableMultiSelect coverage', () => {
  const options = [
    { value: 'id-1', label: 'Item One', description: 'Primary description' },
    { value: 'id-2', label: 'Item Two' },
  ];

  it('handles custom ID addition and empty state when query has no matches', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SearchableMultiSelect ariaLabel="Select items" options={options} onChange={onChange} />,
    );

    const input = screen.getByRole('combobox');
    await user.type(input, 'unmatched-id');

    const customBtn = await screen.findByRole('button', { name: 'Use “unmatched-id” as ID' });
    expect(customBtn).toBeInTheDocument();
    await user.click(customBtn);

    expect(onChange).toHaveBeenCalledWith(['unmatched-id']);
  });

  it('renders No options available when options list is empty and input is focused', async () => {
    render(<SearchableMultiSelect ariaLabel="Empty select" options={[]} />);

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    expect(await screen.findByText('No options available')).toBeInTheDocument();
  });

  it('deselects an already selected option when clicked again in the menu', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SearchableMultiSelect
        ariaLabel="Toggle select"
        options={options}
        values={['id-1']}
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);

    const option = await screen.findByRole('option', { name: /Item One/i });
    expect(option).toHaveAttribute('aria-selected', 'true');

    await user.click(option);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('handles keyboard navigation with ArrowUp, Enter, and Backspace removal', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SearchableMultiSelect
        ariaLabel="Key nav select"
        options={options}
        defaultValue={['id-2']}
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('combobox');
    expect(screen.getByPlaceholderText('Add more…')).toBeInTheDocument();

    // Focus and ArrowUp wraps to last item
    await user.click(input);
    await user.keyboard('{ArrowUp}');
    const opts = await screen.findAllByRole('option');
    expect(opts.at(-1)).toHaveClass('is-active');

    // Enter with active index adds/toggles
    await user.keyboard('{Enter}');

    // Backspace on empty query removes last chip
    await user.keyboard('{Backspace}');
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('closes menu on Escape key or clicking outside', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <SearchableMultiSelect ariaLabel="Dismissable select" options={options} />
        <button type="button">Outside button</button>
      </div>,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    // Escape closes
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Reopen and click outside
    await user.keyboard('{ArrowDown}');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside button' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('handles fallback label when a value has no matching option', () => {
    render(
      <SearchableMultiSelect
        ariaLabel="Unmatched value"
        options={options}
        values={['orphan-id']}
      />,
    );
    expect(screen.getByText('orphan-id')).toBeInTheDocument();
  });
});
