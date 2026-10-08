import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { tokenUsageReport } from '../../test/token-usage-fixture';
import { TokenUsageChart } from './TokenUsageChart';

const bucket = (hour: number, inputTokens: number, outputTokens: number, savedTokens: number) => ({
  start: new Date(Date.UTC(2026, 9, 7, hour)).toISOString(),
  calls: inputTokens || outputTokens ? 1 : 0,
  errors: 0,
  inputTokens,
  outputTokens,
  savedTokens,
  avgDurationMs: 5,
});

const populated = () =>
  tokenUsageReport({
    totals: {
      calls: 2,
      errors: 0,
      inputTokens: 150,
      outputTokens: 500,
      savedTokens: 90,
      avgDurationMs: 5,
    },
    series: [bucket(8, 0, 0, 0), bucket(9, 100, 300, 50), bucket(10, 50, 200, 40)],
  });

describe('TokenUsageChart', () => {
  it('shows an empty state but keeps the range buttons', () => {
    render(<TokenUsageChart report={tokenUsageReport()} range="24h" onRangeChange={() => {}} />);
    expect(screen.getByText('No token usage recorded yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument();
  });

  it('marks the active range and reports changes', async () => {
    const onRangeChange = vi.fn();
    render(<TokenUsageChart report={populated()} range="24h" onRangeChange={onRangeChange} />);
    expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onRangeChange).toHaveBeenCalledWith('all');
  });

  it('draws one bar group per bucket and describes a bucket on hover', async () => {
    render(<TokenUsageChart report={populated()} range="24h" onRangeChange={() => {}} />);
    const bars = screen.getAllByTestId('token-bar');
    expect(bars).toHaveLength(3);
    await userEvent.hover(bars[1]!);
    expect(screen.getByRole('status')).toHaveTextContent('300 out');
    expect(screen.getByRole('status')).toHaveTextContent('100 in');
    expect(screen.getByRole('status')).toHaveTextContent('50 saved');
  });

  it('offers the same data as a table for assistive technology, skipping empty buckets', () => {
    render(<TokenUsageChart report={populated()} range="24h" onRangeChange={() => {}} />);
    const table = screen.getByRole('table', { name: /token usage by period/i });
    expect(within(table).getAllByRole('row')).toHaveLength(3); // header + 2 non-empty buckets
  });

  it('renders while the report is still loading', () => {
    render(<TokenUsageChart report={null} range="24h" onRangeChange={() => {}} />);
    expect(screen.getByText('No token usage recorded yet.')).toBeInTheDocument();
  });
});
