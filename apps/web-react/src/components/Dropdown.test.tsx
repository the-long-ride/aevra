import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Dropdown } from './Dropdown';

const options = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'bytedance', label: 'Bytedance Seed' },
  { value: 'deepseek', label: 'DeepSeek', disabled: true },
];

test('dropdown opens a listbox and reports the selected value', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Dropdown ariaLabel="Provider" options={options} value="anthropic" onChange={onChange} />);

  await user.click(screen.getByRole('button', { name: 'Provider' }));
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: 'Bytedance Seed' }));

  expect(onChange).toHaveBeenCalledWith('bytedance');
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
    within(screen.getByRole('option', { name: 'Bytedance Seed' })).queryByTestId(
      'dropdown-selected-marker',
    ),
  ).toBeNull();

  await user.click(screen.getByRole('option', { name: 'Bytedance Seed' }));
  await user.click(screen.getByRole('button', { name: 'Provider' }));
  expect(
    within(screen.getByRole('option', { name: 'Bytedance Seed' })).getByTestId(
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

test('closes on Escape key press or outside pointerdown', async () => {
  const user = userEvent.setup();
  render(
    <div>
      <div data-testid="outside">Outside area</div>
      <Dropdown ariaLabel="Provider" options={options} defaultValue="anthropic" />
    </div>,
  );

  // Open and close via Escape
  await user.click(screen.getByRole('button', { name: 'Provider' }));
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

  // Open and close via outside pointerdown
  await user.click(screen.getByRole('button', { name: 'Provider' }));
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByTestId('outside'));
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('repositions on window resize and scroll events', async () => {
  const user = userEvent.setup();
  render(<Dropdown ariaLabel="Provider" options={options} defaultValue="anthropic" />);

  await user.click(screen.getByRole('button', { name: 'Provider' }));
  expect(screen.getByRole('listbox')).toBeInTheDocument();

  fireEvent(window, new Event('resize'));
  fireEvent(window, new Event('scroll'));
  expect(screen.getByRole('listbox')).toBeInTheDocument();
});

test('positions above when there is no room below', async () => {
  const user = userEvent.setup();
  // Mock getBoundingClientRect on elements
  const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  try {
    Element.prototype.getBoundingClientRect = function () {
      return {
        width: 150,
        height: 36,
        top: 600,
        bottom: 636,
        left: 50,
        right: 200,
        x: 50,
        y: 600,
        toJSON: () => {},
      };
    };
    Object.defineProperty(window, 'innerHeight', {
      value: 650,
      writable: true,
      configurable: true,
    });

    render(<Dropdown ariaLabel="Provider" options={options} defaultValue="anthropic" />);
    await user.click(screen.getByRole('button', { name: 'Provider' }));

    const menu = screen.getByRole('listbox');
    expect(menu).toHaveAttribute('data-placement', 'above');
  } finally {
    Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
  }
});

test('renders disabled dropdown and disabled option', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <Dropdown
      ariaLabel="Provider"
      options={options}
      disabled={true}
      defaultValue="anthropic"
      onChange={onChange}
    />,
  );

  const trigger = screen.getByRole('button', { name: 'Provider' });
  expect(trigger).toBeDisabled();
  await user.click(trigger);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
