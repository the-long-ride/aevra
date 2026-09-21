import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommandRuleEditor } from './CommandRuleEditor';

describe('CommandRuleEditor', () => {
  it('renders default fields, allows editing, toggles dialects/backends, and saves', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(<CommandRuleEditor onSave={onSave} onCancel={onCancel} />);

    expect(screen.getByText('Typed Command Rule (V2)')).toBeInTheDocument();
    const appInput = screen.getByLabelText(/Application:/);
    expect(appInput).toHaveValue('git');

    const opInput = screen.getByLabelText(/Operation:/);
    expect(opInput).toHaveValue('status');

    // Change application to npm to show script name
    await user.clear(appInput);
    await user.type(appInput, 'npm');

    const scriptInput = await screen.findByLabelText(/Script Name:/);
    await user.type(scriptInput, 'build');

    await user.clear(opInput);
    await user.type(opInput, 'run build');

    const modInput = screen.getByLabelText(/Allowed Modifiers/);
    await user.type(modInput, 'force, dry-run');

    // Toggle a dialect (uncheck direct, check zsh)
    const directCheckbox = screen.getByRole('checkbox', { name: 'direct' });
    expect(directCheckbox).toBeChecked();
    await user.click(directCheckbox);
    expect(directCheckbox).not.toBeChecked();

    const zshCheckbox = screen.getByRole('checkbox', { name: 'zsh' });
    expect(zshCheckbox).not.toBeChecked();
    await user.click(zshCheckbox);
    expect(zshCheckbox).toBeChecked();

    // Toggle a backend (check sandbox)
    const sandboxCheckbox = screen.getByRole('checkbox', { name: 'sandbox' });
    expect(sandboxCheckbox).not.toBeChecked();
    await user.click(sandboxCheckbox);
    expect(sandboxCheckbox).toBeChecked();

    // Save
    await user.click(screen.getByRole('button', { name: 'Save Rule' }));

    expect(onSave).toHaveBeenCalledWith({
      version: 2,
      application: 'npm',
      operation: ['run', 'build'],
      scriptName: 'build',
      allowedModifiers: ['force', 'dry-run'],
      allowedOptions: [],
      positionalConstraint: 'workspace-paths',
      targetScope: 'workspace',
      backends: ['host', 'sandbox'],
      dialects: ['bash', 'pwsh', 'cmd', 'zsh'],
      executableFingerprint: '*',
      wrapperFingerprints: ['*'],
    });
  });

  it('preserves unedited security predicates on a no-op save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const initialRule: any = {
      version: 2,
      application: 'npm',
      operation: ['run', 'build'],
      scriptName: 'build',
      allowedModifiers: ['force'],
      allowedOptions: [{ name: '--workspace', values: ['packages/api'] }],
      positionalConstraint: 'exact',
      exactArgv: ['npm', 'run', 'build', '--workspace', 'packages/api'],
      targetScope: 'workspace',
      backends: ['host'],
      dialects: ['direct', 'bash'],
      executableFingerprint: 'exe-fingerprint',
      wrapperFingerprints: ['wrapper-fingerprint'],
      scriptFingerprint: 'script-fingerprint',
    };

    render(<CommandRuleEditor initialRule={initialRule} onSave={onSave} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Save Rule' }));

    expect(onSave).toHaveBeenCalledWith(initialRule);
  });

  it('renders with initialRule and handles cancel', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(
      <CommandRuleEditor
        initialRule={{
          application: 'pnpm',
          operation: ['test'],
          scriptName: 'unit',
          allowedModifiers: ['watch'],
          dialects: ['bash'] as any,
          backends: ['sandbox'] as any,
        }}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByLabelText(/Application:/)).toHaveValue('pnpm');
    expect(screen.getByLabelText(/Operation:/)).toHaveValue('test');
    expect(screen.getByLabelText(/Script Name:/)).toHaveValue('unit');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
