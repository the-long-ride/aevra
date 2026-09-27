import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { McpActivityEntry } from '@aevra/admin-contracts';
import { DialogProvider } from '../../components/Dialog';
import * as activityHook from '../../hooks/use-mcp-activity';
import type { DashboardData } from './dashboard-service';
import { RequestActivityChart } from './RequestActivityChart';

vi.mock('../../hooks/use-mcp-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-mcp-activity')>();
  return { ...actual, useMcpActivityEntries: vi.fn() };
});

const entries: McpActivityEntry[] = [
  {
    id: 'op_a',
    startedAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:05:00.000Z',
    actor: 'oauth:ChatGPT',
    sessionId: 's1',
    workspaceId: 'ws_1',
    kind: 'tool',
    action: 'git_diff',
    state: 'running',
  },
  {
    id: 'op_done',
    startedAt: '2026-08-28T11:50:00.000Z',
    updatedAt: '2026-08-28T11:51:00.000Z',
    actor: 'oauth:ChatGPT',
    sessionId: 's1',
    workspaceId: 'ws_1',
    kind: 'tool',
    action: 'file_list',
    state: 'success',
  },
];

function data(generatedAt?: string): DashboardData {
  return {
    snapshot: {
      ...(generatedAt ? { generatedAt } : {}),
      status: { mcpDiagnostics: null },
      stats: {},
      pending: { total: 0 },
    },
    workspaces: [{ id: 'ws_1', name: 'Aevra Workspace' }],
  } as unknown as DashboardData;
}

function points(container: HTMLElement) {
  return Array.from(container.querySelectorAll<SVGCircleElement>('.runtime-chart-point'));
}

/** Latest point: only the still-running `git_diff` call is active there. */
function activePoint(container: HTMLElement) {
  return points(container).at(-1)!;
}

/** 11:51, when only the finished `file_list` call was still in flight. */
function earlierPoint(container: HTMLElement) {
  return points(container)[1]!;
}

const tooltipOf = (container: HTMLElement) => container.querySelector('.runtime-chart-tooltip');

beforeEach(() => {
  vi.mocked(activityHook.useMcpActivityEntries).mockReturnValue(entries);
});

afterEach(() => {
  vi.mocked(activityHook.useMcpActivityEntries).mockReset();
});

describe('RequestActivityChart without activity', () => {
  test('draws a flat idle line when there is no history', () => {
    vi.mocked(activityHook.useMcpActivityEntries).mockReturnValue([]);
    const { container } = render(<RequestActivityChart data={data()} />);
    expect(screen.getByText('0 active now')).toBeInTheDocument();
    const circles = points(container);
    expect(circles).toHaveLength(2);
    expect(circles.every((point) => point.getAttribute('data-active') === '0')).toBe(true);
    expect(screen.getByRole('img', { name: 'Scale 0 to 1 requests' })).toBeInTheDocument();
  });
});

describe('RequestActivityChart tooltip interactions', () => {
  test('an idle point reports that no tools were active', () => {
    vi.mocked(activityHook.useMcpActivityEntries).mockReturnValue([
      { ...entries[1]!, startedAt: '2026-08-28T12:00:00.000Z', updatedAt: '2026-08-28T12:01:00.000Z' },
    ]);
    const { container } = render(<RequestActivityChart data={data('2026-08-28T12:02:00.000Z')} />);
    const first = points(container)[0]!;
    expect(first.getAttribute('data-active')).toBe('0');
    fireEvent.mouseEnter(first, { clientX: 10, clientY: 10 });
    expect(screen.getByText('No active tools recorded')).toBeInTheDocument();
  });

  test('moving over a point repositions only an existing unpinned tooltip', () => {
    const { container } = render(<RequestActivityChart data={data('2026-08-28T12:02:00.000Z')} />);
    const point = activePoint(container);
    fireEvent.mouseMove(point, { clientX: 5, clientY: 5 });
    expect(tooltipOf(container)).toBeNull();
    fireEvent.mouseEnter(point, { clientX: 5, clientY: 5 });
    const tooltip = tooltipOf(container) as HTMLElement;
    expect(tooltip.style.left).toBe('5px');
    fireEvent.mouseMove(point, { clientX: 300, clientY: 90 });
    expect(tooltip.style.left).toBe('300px');
    expect(tooltip.style.top).toBe('90px');
  });

  test('a pinned tooltip ignores hover and move on other points', () => {
    const { container } = render(<RequestActivityChart data={data('2026-08-28T12:02:00.000Z')} />);
    const pinned = activePoint(container);
    fireEvent.click(pinned, { clientX: 100, clientY: 100 });
    const other = earlierPoint(container);
    fireEvent.mouseEnter(other, { clientX: 1, clientY: 1 });
    fireEvent.mouseMove(other, { clientX: 2, clientY: 2 });
    expect((tooltipOf(container) as HTMLElement).style.left).toBe('100px');
    expect(screen.getByRole('dialog', { name: 'Active requests details' })).toBeInTheDocument();
    expect(screen.getByText('git_diff')).toBeInTheDocument();
  });

  test('clicking the pinned point again unpins it; clicking another re-pins there', () => {
    const { container } = render(<RequestActivityChart data={data('2026-08-28T12:02:00.000Z')} />);
    const active = activePoint(container);
    const idle = earlierPoint(container);
    fireEvent.click(active);
    fireEvent.click(idle);
    expect(idle).toHaveClass('is-pinned');
    expect(active).not.toHaveClass('is-pinned');
    expect(screen.getByText('file_list')).toBeInTheDocument();
    expect(screen.queryByText('git_diff')).toBeNull();
    fireEvent.click(idle);
    expect(tooltipOf(container)).toBeNull();
  });

  test('pointer and key events inside a pinned tooltip keep it open', () => {
    const { container } = render(<RequestActivityChart data={data('2026-08-28T12:02:00.000Z')} />);
    fireEvent.click(activePoint(container));
    const tooltip = tooltipOf(container) as HTMLElement;
    fireEvent.pointerDown(tooltip);
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.click(tooltip);
    expect(tooltipOf(container)).not.toBeNull();
  });

  test('tool entries do nothing without a dialog provider', () => {
    const { container } = render(<RequestActivityChart data={data('2026-08-28T12:02:00.000Z')} />);
    fireEvent.click(activePoint(container));
    fireEvent.click(screen.getByRole('button', { name: 'git_diff' }));
    expect(screen.queryByText('MCP activity details')).toBeNull();
    expect(tooltipOf(container)).not.toBeNull();
  });

  test('scrolling with no tooltip only updates follow state', () => {
    const { container } = render(
      <DialogProvider>
        <RequestActivityChart data={data('2026-08-28T12:02:00.000Z')} />
      </DialogProvider>,
    );
    const viewport = screen.getByRole('region', { name: 'Request activity timeline' });
    fireEvent.scroll(viewport);
    expect(tooltipOf(container)).toBeNull();
  });
});

describe('RequestActivityChart viewport sizing', () => {
  test('measures the viewport and disconnects its resize observer on unmount', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let callback: () => void = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('runtime-request-chart-viewport') ? 900 : 0;
      });
    const { container, unmount } = render(
      <RequestActivityChart data={data('2026-08-28T12:02:00.000Z')} />,
    );
    const canvas = container.querySelector('.runtime-request-chart-canvas') as HTMLElement;
    expect(observe).toHaveBeenCalledTimes(1);
    const measured = Number.parseInt(canvas.style.width, 10);
    expect(measured).toBeGreaterThanOrEqual(900);

    widthSpy.mockReturnValue(0);
    callback();
    expect(Number.parseInt(canvas.style.width, 10)).toBe(measured);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
