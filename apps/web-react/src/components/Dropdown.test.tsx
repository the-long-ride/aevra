import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Dropdown } from './Dropdown';

const options = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'bytedance', label: 'Bytedance Seed' },
  { value: 'deepseek', label: 'DeepSeek' },
];

test('dropdown opens a listbox and reports the selected value', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Dropdown ariaLabel="Provider" options={options} value="anthropic" onChange={onChange} />);

  await user.click(screen.getByRole('button', { name: 'Provider' }));
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: 'DeepSeek' }));

  expect(onChange).toHaveBeenCalledWith('deepseek');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('dropdown marks the current selection with a wide pixel chevron', async () => {
  const user = userEvent.setup();
  render(<Dropdown ariaLabel="Provider" options={options} defaultValue="anthropic" />);

  await user.click(screen.getByRole('button', { name: 'Provider' }));
  const first = screen.getByRole('option', { name: 'Anthropic' });
  const marker = within(first).getByTestId('dropdown-selected-marker');
  expect(marker).toBeInTheDocument();
  expect(marker).toHaveAttribute('viewBox', '0 0 12 8');
  expect(
    within(screen.getByRole('option', { name: 'DeepSeek' })).queryByTestId(
      'dropdown-selected-marker',
    ),
  ).toBeNull();

  await user.click(screen.getByRole('option', { name: 'DeepSeek' }));
  await user.click(screen.getByRole('button', { name: 'Provider' }));
  expect(
    within(screen.getByRole('option', { name: 'DeepSeek' })).getByTestId(
      'dropdown-selected-marker',
    ),
  ).toBeInTheDocument();
});

test('dropdown participates in FormData for uncontrolled forms', async () => {
  const user = userEvent.setup();
  render(
    <form data-testid="form">
      <Dropdown name="provider" ariaLabel="Provider" options={options} defaultValue="anthropic" />
    </form>,
  );

  await user.click(screen.getByRole('button', { name: 'Provider' }));
  await user.click(screen.getByRole('option', { name: 'Bytedance Seed' }));

  const form = screen.getByTestId('form') as HTMLFormElement;
  expect(new FormData(form).get('provider')).toBe('bytedance');
});
