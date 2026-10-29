import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SwapControl } from './SwapControl';

describe('SwapControl', () => {
  it('renders options as a radiogroup with selected option checked', () => {
    const onChange = vi.fn();
    render(
      <SwapControl
        name="test-scope"
        ariaLabel="Scope"
        value="user"
        onChange={onChange}
        options={[
          { value: 'user', label: 'Allow all apps' },
          { value: 'workspace', label: 'Only these apps' },
        ]}
      />,
    );

    const group = screen.getByRole('radiogroup', { name: 'Scope' });
    expect(group).toBeInTheDocument();

    const userRadio = screen.getByRole('radio', { name: 'Allow all apps' });
    const wsRadio = screen.getByRole('radio', { name: 'Only these apps' });

    expect(userRadio).toBeChecked();
    expect(wsRadio).not.toBeChecked();

    fireEvent.click(wsRadio);
    expect(onChange).toHaveBeenCalledWith('workspace');
  });

  it('prevents selection when option or component is disabled', () => {
    const onChange = vi.fn();
    render(
      <SwapControl
        name="test-transport"
        ariaLabel="Transport"
        value="stdio"
        onChange={onChange}
        options={[
          { value: 'stdio', label: 'stdio' },
          { value: 'http', label: 'HTTP', disabled: true },
        ]}
      />,
    );

    const httpRadio = screen.getByRole('radio', { name: 'HTTP' });
    expect(httpRadio).toBeDisabled();

    fireEvent.click(httpRadio);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies console-radio compatibility classes for unified styling', () => {
    render(
      <SwapControl
        name="test-style"
        ariaLabel="Style test"
        value="first"
        onChange={vi.fn()}
        options={[
          { value: 'first', label: 'First' },
          { value: 'second', label: 'Second', disabled: true },
        ]}
      />,
    );

    const group = screen.getByRole('radiogroup', { name: 'Style test' });
    expect(group).toHaveClass('swap-control', 'console-radio-group');

    const firstRadio = screen.getByRole('radio', { name: 'First' });
    const firstLabel = firstRadio.closest('label');
    expect(firstLabel).toHaveClass('swap-option', 'console-radio-option', 'active', 'is-selected');

    const secondRadio = screen.getByRole('radio', { name: 'Second' });
    const secondLabel = secondRadio.closest('label');
    expect(secondLabel).toHaveClass(
      'swap-option',
      'console-radio-option',
      'disabled',
      'is-disabled',
    );
  });
});
