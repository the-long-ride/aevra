import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { CommandList, CommandResultList } from './CommandCallView';

test('single command shows shell, mode, cwd and whole-second timeout chips without an index', () => {
  render(
    <CommandList
      commands={[
        { line: 'npm test', shell: 'pwsh', mode: 'host', cwd: '/apps/web', timeoutMs: 30000 },
      ]}
    />,
  );

  expect(screen.queryByText('#1')).not.toBeInTheDocument();
  expect(screen.getByText('pwsh')).toBeInTheDocument();
  expect(screen.getByText('host')).toBeInTheDocument();
  expect(screen.getByTitle('Working directory')).toHaveTextContent('/apps/web');
  expect(screen.getByText('timeout 30s')).toBeInTheDocument();
  expect(screen.getByTestId('command-line')).toHaveTextContent('npm test');
});

test('several commands are numbered and odd timeouts are shown in milliseconds', () => {
  render(<CommandList commands={[{ line: 'git status', timeoutMs: 1500 }, { line: 'git log' }]} />);

  expect(screen.getByText('#1')).toBeInTheDocument();
  expect(screen.getByText('#2')).toBeInTheDocument();
  expect(screen.getByText('timeout 1500 ms')).toBeInTheDocument();
  expect(screen.getAllByTestId('command-line')).toHaveLength(2);
});

test('result badges cover timed out, signal, failure and unknown outcomes', () => {
  render(
    <CommandResultList
      results={[
        { timedOut: true, stdout: 'partial' },
        { signal: 'SIGTERM', stderr: 'stopped' },
        { error: 'spawn failed' },
        {},
        { exitCode: 0, durationMs: 12, stdout: 'done' },
      ]}
    />,
  );

  const items = screen.getAllByTestId('command-result');
  expect(within(items[0]!).getByText('timed out')).toHaveClass('error');
  expect(within(items[1]!).getByText('SIGTERM')).toHaveClass('error');
  expect(within(items[2]!).getByText('failed')).toBeInTheDocument();
  expect(within(items[2]!).getByRole('alert')).toHaveTextContent('spawn failed');
  expect(within(items[3]!).getByText('No output.')).toBeInTheDocument();
  expect(within(items[3]!).queryByText(/exit|failed|timed out/)).not.toBeInTheDocument();
  expect(within(items[4]!).getByText('exit 0')).toHaveClass('success');
  expect(within(items[4]!).getByText('12 ms')).toBeInTheDocument();
  expect(within(items[4]!).getByText('#5')).toBeInTheDocument();
});

test('single-line stream reads as one line and has no expand control', () => {
  render(<CommandResultList results={[{ exitCode: 2, stdout: 'only line' }]} />);

  const stream = screen.getByTestId('command-stream-stdout');
  expect(within(stream).getByText('1 line')).toBeInTheDocument();
  expect(within(stream).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByText('exit 2')).toHaveClass('error');
});

test('long stderr expands to every line and collapses back to the tail', async () => {
  const user = userEvent.setup();
  const text = Array.from({ length: 25 }, (_, i) => `warn ${i + 1}`).join('\n') + '\n';
  render(
    <CommandResultList
      results={[{ exitCode: 1, stderr: text }]}
      commands={[{ line: 'npm run lint' }]}
    />,
  );

  expect(screen.getByTitle('npm run lint')).toHaveTextContent('npm run lint');
  const stream = screen.getByTestId('command-stream-stderr');
  expect(within(stream).getByText(/^last 20 of/)).toBeInTheDocument();
  expect(within(stream).queryByText(/warn 1\n/)).not.toBeInTheDocument();

  await user.click(within(stream).getByRole('button', { name: /^Show all/ }));
  expect(within(stream).getByText(/lines$/)).not.toHaveTextContent('last');
  expect(stream.querySelector('pre')?.textContent).toContain('warn 1\n');

  await user.click(within(stream).getByRole('button', { name: 'Show last 20' }));
  expect(within(stream).getByText(/^last 20 of/)).toBeInTheDocument();
});
