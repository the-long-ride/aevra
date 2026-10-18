import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { fetchTokenUsage } from '../../services/token-usage-service';
import { tokenUsageReport } from '../../test/token-usage-fixture';
import { TokenUsageChart } from './TokenUsageChart';

vi.mock('../../services/token-usage-service', () => ({ fetchTokenUsage: vi.fn() }));

test('opens all-time statistics without changing the chart range and restores focus', async () => {
  const user = userEvent.setup();
  const onRangeChange = vi.fn();
  const totals = {
    calls: 4,
    errors: 1,
    inputTokens: 100,
    outputTokens: 300,
    savedTokens: 200,
    avgDurationMs: 20,
  };
  vi.mocked(fetchTokenUsage).mockResolvedValue(
    tokenUsageReport({
      range: 'all',
      totals,
      byTool: [{ tool: 'files_read', ...totals }],
      byConnector: [{ connector: 'client:alpha', label: 'alpha', ...totals }],
    }),
  );
  render(<TokenUsageChart report={tokenUsageReport()} range="7d" onRangeChange={onRangeChange} />);
  const trigger = screen.getByRole('button', { name: 'All-time statistics' });
  expect(screen.getByRole('button', { name: 'All' }).nextElementSibling).toBe(trigger);
  await user.click(trigger);
  const modal = screen.getByRole('dialog', { name: 'All-time token statistics' });
  expect(await within(modal).findByText('files_read')).toBeInTheDocument();
  expect(within(modal).getByText('alpha')).toBeInTheDocument();
  expect(within(modal).getByLabelText('Input tokens')).toHaveTextContent('100');
  expect(within(modal).getByLabelText('Average tokens per call')).toHaveTextContent('100');
  expect(within(modal).getByLabelText('Saved tokens').querySelector('strong')).toHaveTextContent(
    '200 ~ 40%',
  );
  expect(within(modal).getByLabelText('Saved tokens').children).toHaveLength(2);
  expect(onRangeChange).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).toHaveFocus();
  expect(fetchTokenUsage).toHaveBeenCalledWith('all', expect.any(AbortSignal));
});

test('shows loading, error with retry, and empty statistics', async () => {
  vi.mocked(fetchTokenUsage).mockRejectedValueOnce(new Error('Offline'));
  vi.mocked(fetchTokenUsage).mockResolvedValue(tokenUsageReport({ range: 'all' }));
  render(<TokenUsageChart report={null} range="24h" onRangeChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'All-time statistics' }));
  expect(screen.getByText('Loading all-time statistics…')).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByRole('dialog')).toHaveTextContent('No token usage recorded yet.'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
