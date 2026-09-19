import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchableMultiSelect } from './SearchableMultiSelect';

const SAMPLE_OPTIONS = [
  { value: 'ws-1', label: 'Quotashift', description: 'ID: ws-1 · /repo/quotashift' },
  { value: 'ws-2', label: 'Aevra Core', description: 'ID: ws-2 · /repo/aevra' },
  { value: 'ws-3', label: 'Mobile App', description: 'ID: ws-3 · /repo/mobile' },
];

describe('SearchableMultiSelect', () => {
  it('renders input with placeholder and label', () => {
    render(
      <SearchableMultiSelect
        ariaLabel="Workspace IDs"
        placeholder="Search workspace by name…"
        options={SAMPLE_OPTIONS}
      />,
    );
    expect(screen.getByLabelText('Workspace IDs')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Search workspace by name…'),
    ).toBeInTheDocument();
  });

  it('filters options by name and selects via click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SearchableMultiSelect
        ariaLabel="Workspace IDs"
        options={SAMPLE_OPTIONS}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText('Workspace IDs');
    await user.type(input, 'Quota');

    // Option should be visible in portal
    const option = await screen.findByRole('option', { name: /Quotashift/i });
    expect(option).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Mobile App/i })).not.toBeInTheDocument();

    await user.click(option);
    expect(onChange).toHaveBeenCalledWith(['ws-1']);
    expect(screen.getByRole('button', { name: 'Remove Quotashift' })).toBeInTheDocument();
  });

  it('removes selected chip when remove button is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SearchableMultiSelect
        ariaLabel="Workspace IDs"
        options={SAMPLE_OPTIONS}
        values={['ws-1', 'ws-2']}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Quotashift')).toBeInTheDocument();
    expect(screen.getByText('Aevra Core')).toBeInTheDocument();

    const removeBtn = screen.getByRole('button', { name: 'Remove Quotashift' });
    await user.click(removeBtn);

    expect(onChange).toHaveBeenCalledWith(['ws-2']);
  });

  it('supports keyboard navigation and enter selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SearchableMultiSelect
        ariaLabel="Workspace IDs"
        options={SAMPLE_OPTIONS}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText('Workspace IDs');
    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith(['ws-1']);
  });

  it('populates hidden input for form submission', async () => {
    const user = userEvent.setup();
    render(
      <form data-testid="test-form">
        <SearchableMultiSelect
          name="workspaceIds"
          ariaLabel="Workspace IDs"
          options={SAMPLE_OPTIONS}
          defaultValue={['ws-1']}
        />
      </form>,
    );

    const hiddenInput = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="workspaceIds"]',
    );
    expect(hiddenInput).not.toBeNull();
    expect(hiddenInput?.value).toBe('ws-1');

    // Type extra ID without clicking dropdown
    const input = screen.getByLabelText('Workspace IDs');
    await user.type(input, 'ws-custom');

    expect(hiddenInput?.value).toBe('ws-1,ws-custom');
  });

  it('resolves typed exact option name into its ID in hidden input', async () => {
    const user = userEvent.setup();
    render(
      <form data-testid="test-form">
        <SearchableMultiSelect
          name="workspaceIds"
          ariaLabel="Workspace IDs"
          options={SAMPLE_OPTIONS}
        />
      </form>,
    );

    const input = screen.getByLabelText('Workspace IDs');
    await user.type(input, 'Quotashift');

    const hiddenInput = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="workspaceIds"]',
    );
    expect(hiddenInput?.value).toBe('ws-1');
  });
});
