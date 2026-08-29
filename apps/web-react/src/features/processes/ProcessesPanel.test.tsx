import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { ProcessesPanel } from './ProcessesPanel';

test('process rows derive readable names and protect detached processes', async () => {
  installApiFixtures({
    routes: {
      '/api/processes': [
        {
          id: 'proc-string',
          command: '  npm test  ',
          workspace_id: 'ws-string',
          state: 'running',
          ownership: 'owned',
        },
        {
          id: 'proc-object',
          command: { executable: 'node', args: ['script.js', 2] },
          workspace_name: 'Named workspace',
          state: 'running',
          ownership: 'owned',
        },
        {
          id: 'proc-no-args',
          command: { executable: 'python', args: '--version' },
          state: 'running',
          ownership: 'owned',
        },
        {
          id: 'proc-fallback',
          command: { args: ['ignored'] },
          state: 'unknown',
          ownership: 'detached-uncertain',
        },
      ],
    },
  });

  render(
    <DialogProvider>
      <ProcessesPanel contained />
    </DialogProvider>,
  );

  expect(await screen.findByText('npm test')).toBeInTheDocument();
  expect(screen.getByText('node script.js 2')).toBeInTheDocument();
  expect(screen.getByText('python')).toBeInTheDocument();
  const fallbackName = screen.getByText('proc-fallback', { selector: 'code' });
  expect(fallbackName).toBeInTheDocument();
  expect(screen.getByText('ws-string')).toBeInTheDocument();
  expect(screen.getByText('Named workspace')).toBeInTheDocument();

  const fallbackRow = fallbackName.closest('tr');
  expect(fallbackRow).not.toBeNull();
  expect(within(fallbackRow!).getByRole('button', { name: 'Stop' })).toBeDisabled();
  expect(within(fallbackRow!).getByRole('button', { name: 'Restart' })).toBeDisabled();
  expect(within(fallbackRow!).getByRole('button', { name: 'Forget' })).toBeEnabled();
});

test('clicking process name opens dialog with full command', async () => {
  const user = userEvent.setup();
  installApiFixtures({
    routes: {
      '/api/processes': [
        {
          id: 'proc-1',
          command:
            'node --inspect-brk=0.0.0.0:9229 --max-old-space-size=4096 server.js --port 8080',
          workspace_id: 'ws-1',
          state: 'running',
          ownership: 'owned',
        },
      ],
    },
  });

  render(
    <DialogProvider>
      <ProcessesPanel contained />
    </DialogProvider>,
  );

  const button = await screen.findByRole('button', {
    name: 'node --inspect-brk=0.0.0.0:9229 --max-old-space-size=4096 server.js --port 8080',
  });
  expect(button).toBeInTheDocument();
  await user.click(button);

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Process command / name')).toBeInTheDocument();
  expect(
    within(dialog).getByText(
      'node --inspect-brk=0.0.0.0:9229 --max-old-space-size=4096 server.js --port 8080',
    ),
  ).toBeInTheDocument();
});
