import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { tokenUsageReport } from '../../test/token-usage-fixture';
import type { DashboardData } from './dashboard-service';
import { RuntimeOverview } from './RuntimeOverview';

vi.mock('../../hooks/use-token-usage', () => ({
  useTokenUsage: () => ({
    data: tokenUsageReport(),
    error: null,
    loading: false,
    refresh: async () => undefined,
  }),
}));

function dashboardDataAt(generatedAt = '2026-08-28T12:10:00.000Z'): DashboardData {
  return {
    snapshot: {
      generatedAt,
      status: { mcpDiagnostics: null },
      stats: {
        sessions: 0,
        workspaceLeases: 0,
        processes: 0,
        openChanges: 0,
        toolCalls: 0,
        connectors: 0,
      },
      pending: { total: 0 },
      power: null,
      transport: null,
    },
    onboarding: {},
    exposure: {},
    workspaces: [],
  } as unknown as DashboardData;
}

function renderRuntime(data = dashboardDataAt()) {
  return render(
    <RuntimeOverview
      data={data}
      onOpen={() => undefined}
      onOpenPending={() => undefined}
      onOpenTransport={() => undefined}
    />,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

test('request activity exposes a horizontally navigable timeline viewport', () => {
  renderRuntime();

  const viewport = screen.getByRole('region', { name: 'Request activity timeline' });
  expect(viewport).toHaveAttribute('tabindex', '0');
  expect(viewport).toHaveAttribute('data-following', 'true');
  expect(screen.getByText(/Alt \+ wheel to zoom/i)).toBeInTheDocument();
});

test('Alt plus wheel zooms the visible request activity time window and prevents default', () => {
  renderRuntime();

  const viewport = screen.getByRole('region', { name: 'Request activity timeline' });
  const initialWindow = Number(viewport.getAttribute('data-window-ms'));
  expect(initialWindow).toBeGreaterThan(0);

  const wheelEvent = new WheelEvent('wheel', {
    altKey: true,
    deltaY: -120,
    bubbles: true,
    cancelable: true,
  });
  fireEvent(viewport, wheelEvent);
  expect(wheelEvent.defaultPrevented).toBe(true);

  const zoomedInWindow = Number(viewport.getAttribute('data-window-ms'));
  expect(zoomedInWindow).toBeLessThan(initialWindow);

  fireEvent.wheel(viewport, { altKey: true, deltaY: 120 });
  expect(Number(viewport.getAttribute('data-window-ms'))).toBeGreaterThan(zoomedInWindow);
});

test('manual chart interaction pauses live follow and resumes after ten idle seconds', () => {
  vi.useFakeTimers();
  renderRuntime();

  const viewport = screen.getByRole('region', { name: 'Request activity timeline' });
  fireEvent.pointerDown(viewport);
  expect(viewport).toHaveAttribute('data-following', 'false');

  act(() => vi.advanceTimersByTime(9_999));
  expect(viewport).toHaveAttribute('data-following', 'false');

  act(() => vi.advanceTimersByTime(1));
  expect(viewport).toHaveAttribute('data-following', 'true');
});

test('live follow keeps the request activity viewport pinned to the newest data', () => {
  const { rerender } = renderRuntime(dashboardDataAt('2026-08-28T12:10:00.000Z'));
  const viewport = screen.getByRole('region', { name: 'Request activity timeline' });

  Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 1_200 });
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 400 });
  viewport.scrollLeft = 0;

  rerender(
    <RuntimeOverview
      data={dashboardDataAt('2026-08-28T12:10:02.000Z')}
      onOpen={() => undefined}
      onOpenPending={() => undefined}
      onOpenTransport={() => undefined}
    />,
  );

  expect(viewport.scrollLeft).toBe(800);
});

test('request activity uses rounded step transitions instead of square polyline corners', () => {
  renderRuntime();

  const chart = screen.getByLabelText('Active requests over runtime');
  expect(chart.querySelector('path.runtime-chart-line')).not.toBeNull();
  expect(chart.querySelector('polyline.runtime-chart-line')).toBeNull();
});

test('request activity displays request count scale on the right side Y-axis', () => {
  renderRuntime();

  const chart = screen.getByLabelText('Active requests over runtime');
  const yAxis = chart.querySelector('.runtime-chart-y-axis');
  expect(yAxis).not.toBeNull();
  expect(yAxis?.textContent).toContain('0');

  // Main SVG timeline only contains time labels, not request count numbers on the left
  const mainSvg = chart.querySelector('.runtime-request-chart-viewport svg');
  const mainSvgLabels = Array.from(mainSvg?.querySelectorAll('text') ?? []).map(
    (t) => t.textContent,
  );
  expect(mainSvgLabels).not.toContain('0');
});

test('token usage cards fill the runtime metrics grid without duplicating the cards below', () => {
  const { container } = renderRuntime();
  const metrics = container.querySelector('.runtime-grid');
  const tokenCards = metrics?.querySelector('.token-usage-stats');

  expect(tokenCards).not.toBeNull();
  expect(tokenCards?.querySelectorAll('.token-stat')).toHaveLength(5);
  expect(tokenCards).toContainElement(screen.getByText('Tokens out today'));
  expect(tokenCards).toContainElement(screen.getByText('Top tool today'));
  expect(container.querySelectorAll('.token-usage-stats')).toHaveLength(1);
  expect(metrics?.lastElementChild).toBe(tokenCards);
});

test('both runtime charts share a responsive layout container', () => {
  const { container } = renderRuntime();
  const charts = container.querySelector('.runtime-charts');

  expect(charts?.children).toHaveLength(2);
  expect(charts?.children[0]).toHaveClass('runtime-request-chart');
  expect(charts?.children[1]).toHaveClass('token-usage-chart');
});
