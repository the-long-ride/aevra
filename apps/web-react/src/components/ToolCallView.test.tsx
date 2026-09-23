import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { DetailModeToggle, ToolCallView, useDetailMode } from './ToolCallView';

const manyInput = JSON.stringify({
  commands: [
    { executable: 'npm', args: ['test'], cwdLogical: '/apps/web-react' },
    { executable: 'git', args: ['commit', '-m', 'fix: tidy up'], executionMode: 'host' },
  ],
});

const longStdout = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');

const manyOutput = JSON.stringify({
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        results: [
          { index: 0, ok: true, value: { ok: true, value: { exitCode: 0, stdout: longStdout } } },
          { index: 1, ok: true, value: { exitCode: 1, stdout: '', stderr: 'nothing to commit' } },
        ],
      }),
    },
  ],
});

afterEach(() => {
  localStorage.clear();
});

test('pretty input lists each command line with its context', () => {
  render(<ToolCallView side="input" action="command_run_many" raw={manyInput} mode="pretty" />);
  const lines = screen.getAllByTestId('command-line');
  expect(lines[0]).toHaveTextContent('npm test');
  expect(lines[1]).toHaveTextContent('git commit -m "fix: tidy up"');
  expect(screen.getByText('/apps/web-react')).toBeInTheDocument();
  expect(screen.getByText('host')).toBeInTheDocument();
});

test('pretty output shows exit codes and only the tail of long output', async () => {
  const user = userEvent.setup();
  render(
    <ToolCallView
      side="output"
      action="command_run_many"
      raw={manyOutput}
      input={manyInput}
      mode="pretty"
    />,
  );
  expect(screen.getByText('exit 0')).toBeInTheDocument();
  expect(screen.getByText('exit 1')).toBeInTheDocument();
  expect(screen.getByText('nothing to commit')).toBeInTheDocument();
  const results = screen.getAllByTestId('command-result');
  expect(within(results[0]!).getByText('npm test')).toBeInTheDocument();

  const stdout = within(results[0]!).getByTestId('command-stream-stdout');
  expect(stdout).toHaveTextContent('line 30');
  expect(stdout).not.toHaveTextContent(/\bline 10\b/);
  await user.click(within(results[0]!).getByRole('button', { name: 'Show all 30 lines' }));
  expect(within(results[0]!).getByTestId('command-stream-stdout')).toHaveTextContent('line 5');
});

test('pretty output unwraps MCP envelopes for non-command tools', () => {
  const raw = JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify({ entries: [{ name: 'README.md' }] }) }],
    structuredContent: { entries: [{ name: 'README.md' }] },
  });
  render(<ToolCallView side="output" action="file_list" raw={raw} mode="pretty" />);
  expect(screen.getByText('entries')).toBeInTheDocument();
  expect(screen.getByText('README.md')).toBeInTheDocument();
  expect(screen.queryByText('structuredContent')).not.toBeInTheDocument();
});

test('pretty output surfaces tool errors', () => {
  const raw = JSON.stringify({
    isError: true,
    content: [
      { type: 'text', text: JSON.stringify({ error: { code: 'DENIED', message: 'Nope' } }) },
    ],
  });
  render(<ToolCallView side="output" action="file_read" raw={raw} mode="pretty" />);
  expect(screen.getByRole('alert')).toHaveTextContent('DENIED: Nope');
});

test('pretty view notes server-side truncation', () => {
  const raw = '{"path": "READ\n… [truncated]';
  render(<ToolCallView side="input" action="file_read" raw={raw} mode="pretty" />);
  expect(screen.getByText(/Truncated by the server/)).toBeInTheDocument();
  expect(screen.getByText('READ')).toBeInTheDocument();
});

test('raw mode shows the exact recorded text', () => {
  render(<ToolCallView side="output" action="command_run_many" raw={manyOutput} mode="raw" />);
  expect(screen.getByTestId('json-detail-raw').textContent).toBe(manyOutput);
  expect(screen.queryByTestId('command-result')).not.toBeInTheDocument();
});

test('shows the empty text when nothing was recorded', () => {
  render(
    <ToolCallView side="output" action="file_read" mode="pretty" emptyText="Still running." />,
  );
  expect(screen.getByText('Still running.')).toBeInTheDocument();
});

function ModeHarness() {
  const [mode, setMode] = useDetailMode();
  return (
    <>
      <DetailModeToggle mode={mode} onChange={setMode} />
      <output>{mode}</output>
    </>
  );
}

test('detail mode defaults to pretty and remembers the last choice', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<ModeHarness />);
  expect(screen.getByRole('status')).toHaveTextContent('pretty');
  expect(screen.getByRole('button', { name: 'Pretty' })).toHaveAttribute('aria-pressed', 'true');

  await user.click(screen.getByRole('button', { name: 'Raw' }));
  expect(screen.getByRole('status')).toHaveTextContent('raw');
  unmount();

  render(<ModeHarness />);
  expect(screen.getByRole('status')).toHaveTextContent('raw');
});
