import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { DialogProvider, useDialog } from './Dialog';

function Harness() {
  const dialog = useDialog();
  const [result, setResult] = useState('');
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void dialog
            .message({ title: 'Notice', message: 'Saved successfully.' })
            .then(() => setResult('message:ok'))
        }
      >
        Open message
      </button>
      <button
        type="button"
        onClick={() =>
          void dialog
            .confirm({ title: 'Confirm action', message: 'Continue?', confirmLabel: 'Continue' })
            .then((value) => setResult(`confirm:${value}`))
        }
      >
        Open confirm
      </button>
      <button
        type="button"
        onClick={() =>
          void dialog
            .choose({
              title: 'Choose action',
              message: 'Pick one.',
              actions: [
                { id: 'keep', label: 'Keep', tone: 'primary' },
                { id: 'rollback', label: 'Rollback', tone: 'danger' },
                { id: 'cancel', label: 'Cancel' },
              ],
              cancelId: 'cancel',
            })
            .then((value) => setResult(`choice:${value ?? 'cancelled'}`))
        }
      >
        Open choice
      </button>
      <button
        type="button"
        onClick={() =>
          void dialog
            .prompt({
              title: 'Rename change set',
              label: 'Name',
              initialValue: 'Old name',
              confirmLabel: 'Save',
              required: true,
            })
            .then((value) => setResult(`prompt:${value ?? 'cancelled'}`))
        }
      >
        Open prompt
      </button>
      <output>{result}</output>
    </>
  );
}

function renderHarness() {
  render(
    <DialogProvider>
      <Harness />
    </DialogProvider>,
  );
}

test('message dialog resolves after acknowledgement', async () => {
  const user = userEvent.setup();
  renderHarness();
  await user.click(screen.getByRole('button', { name: 'Open message' }));
  const dialog = screen.getByRole('dialog', { name: 'Notice' });
  expect(within(dialog).getByText('Saved successfully.')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'OK' }));
  expect(screen.getByText('message:ok')).toBeInTheDocument();
});

test('confirmation dialog resolves true or false', async () => {
  const user = userEvent.setup();
  renderHarness();
  await user.click(screen.getByRole('button', { name: 'Open confirm' }));
  let dialog = screen.getByRole('dialog', { name: 'Confirm action' });
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('confirm:false')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Open confirm' }));
  dialog = screen.getByRole('dialog', { name: 'Confirm action' });
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
  expect(screen.getByText('confirm:true')).toBeInTheDocument();
});

test('choice dialog supports three buttons', async () => {
  const user = userEvent.setup();
  renderHarness();
  await user.click(screen.getByRole('button', { name: 'Open choice' }));
  const dialog = screen.getByRole('dialog', { name: 'Choose action' });
  expect(within(dialog).getAllByRole('button')).toHaveLength(3);
  await user.click(within(dialog).getByRole('button', { name: 'Rollback' }));
  expect(screen.getByText('choice:rollback')).toBeInTheDocument();
});

test('prompt dialog returns edited text', async () => {
  const user = userEvent.setup();
  renderHarness();
  await user.click(screen.getByRole('button', { name: 'Open prompt' }));
  const dialog = screen.getByRole('dialog', { name: 'Rename change set' });
  const input = within(dialog).getByLabelText('Name');
  await user.clear(input);
  await user.type(input, 'New name');
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(screen.getByText('prompt:New name')).toBeInTheDocument();
});
