import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { tokenUsageReport } from '../../test/token-usage-fixture';
import { TokenUsageStats } from './TokenUsageStats';

const box = (label: string) => screen.getByText(label).closest('[data-stat]') as HTMLElement;

describe('TokenUsageStats', () => {
  it('shows zeros and a dash for an empty day', () => {
    render(<TokenUsageStats report={tokenUsageReport()} />);
    expect(within(box('Tokens out today')).getByText('0')).toBeInTheDocument();
    expect(within(box('Top tool today')).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('est.')).toBeInTheDocument();
  });

  it('shows todays totals, the saving and the top tool', () => {
    render(
      <TokenUsageStats
        report={tokenUsageReport({
          today: {
            calls: 4,
            errors: 0,
            inputTokens: 1200,
            outputTokens: 3400,
            savedTokens: 600,
            avgDurationMs: 20,
          },
          topToolToday: { tool: 'file_read_many', outputTokens: 2100 },
        })}
      />,
    );
    expect(within(box('Tokens out today')).getByText('3.4k')).toBeInTheDocument();
    expect(within(box('Tokens in today')).getByText('1.2k')).toBeInTheDocument();
    expect(within(box('Saved today')).getByText('600')).toBeInTheDocument();
    expect(within(box('Saved today')).getByText('15% less than raw')).toBeInTheDocument();
    expect(within(box('Avg tokens per call')).getByText('1.2k')).toBeInTheDocument();
    expect(within(box('Top tool today')).getByText('file_read_many')).toBeInTheDocument();
    expect(within(box('Top tool today')).getByText('2.1k out')).toBeInTheDocument();
  });

  it('shows a status line while loading and when the request failed', () => {
    const { rerender } = render(<TokenUsageStats report={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading token usage');
    rerender(<TokenUsageStats report={null} error="offline" />);
    expect(screen.getByRole('status')).toHaveTextContent('Token usage unavailable.');
  });
});
