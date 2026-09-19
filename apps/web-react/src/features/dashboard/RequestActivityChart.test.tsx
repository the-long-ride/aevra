import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { McpActivityEntry } from '@aevra/admin-contracts';
import { DialogProvider } from '../../components/Dialog';
import * as activityHook from '../../hooks/use-mcp-activity';
import type { DashboardData } from './dashboard-service';
import { RequestActivityChart } from './RequestActivityChart';

vi.mock('../../hooks/use-mcp-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-mcp-activity')>();
  return {
    ...actual,
    useMcpActivityEntries: vi.fn(),
  };
});

const mockEntries: McpActivityEntry[] = [
  {
    id: 'op_1',
    startedAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:05:00.000Z',
    actor: 'oauth:ChatGPT',
    sessionId: 's1',
    workspaceId: 'ws_1',
    kind: 'tool',
    action: 'git_diff',
    state: 'running',
    input: '{"path": "README.md"}',
    output: 'diff content',
  },
  {
    id: 'op_2',
    startedAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:05:00.000Z',
    actor: 'oauth:ChatGPT',
    sessionId: 's1',
    workspaceId: 'ws_1',
    kind: 'tool',
    action: 'git_status',
    state: 'running',
  },
  {
    id: 'op_3',
    startedAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:05:00.000Z',
    actor: 'connector:Claude',
    sessionId: 's2',
    workspaceId: 'ws_1',
    kind: 'tool',
    action: 'file_read',
    state: 'running',
  },
];

function createDashboardData(): DashboardData {
  return {
    snapshot: {
      generatedAt: '2026-08-28T12:02:00.000Z',
      status: { mcpDiagnostics: null },
      stats: {
        sessions: 1,
        workspaceLeases: 1,
        processes: 0,
        openChanges: 0,
        toolCalls: 3,
        connectors: 2,
      },
      pending: { total: 0 },
      power: null,
      transport: null,
    },
    onboarding: {},
    exposure: {},
    workspaces: [{ id: 'ws_1', name: 'Aevra Workspace' }],
  } as unknown as DashboardData;
}

describe('RequestActivityChart interactions and tooltip', () => {
  beforeEach(() => {
    vi.mocked(activityHook.useMcpActivityEntries).mockReturnValue(mockEntries);
  });

  test('hovering on a point displays active tools grouped by connector with number only on top right', () => {
    const { container } = render(
      <DialogProvider>
        <RequestActivityChart data={createDashboardData()} />
      </DialogProvider>,
    );

    const points = container.querySelectorAll('.runtime-chart-point');
    expect(points.length).toBeGreaterThan(0);

    // Hover over a point
    const point = points[1] ?? points[0];
    fireEvent.mouseEnter(point, { clientX: 200, clientY: 150 });

    // Tooltip should be visible
    const tooltip = container.querySelector('.runtime-chart-tooltip');
    expect(tooltip).not.toBeNull();

    // The number of active should be a number only (e.g. "3" or "0") without "active" label
    const countEl = tooltip?.querySelector('.runtime-chart-tooltip-count');
    expect(countEl).not.toBeNull();
    expect(countEl?.textContent?.trim()).toMatch(/^\d+$/);

    // Connector groups should be present
    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();

    // Tools called should be grouped under their connectors
    expect(screen.getByText('git_diff')).toBeInTheDocument();
    expect(screen.getByText('git_status')).toBeInTheDocument();
    expect(screen.getByText('file_read')).toBeInTheDocument();

    // Mouse leave hides the unpinned tooltip
    fireEvent.mouseLeave(point);
    expect(container.querySelector('.runtime-chart-tooltip')).toBeNull();
  });

  test('clicking a point keeps the tooltip pinned on screen, and clicking a tool call opens detail activity', async () => {
    const { container } = render(
      <DialogProvider>
        <RequestActivityChart data={createDashboardData()} />
      </DialogProvider>,
    );

    const points = container.querySelectorAll('.runtime-chart-point');
    const point = points[1] ?? points[0];

    // Click to pin
    fireEvent.click(point, { clientX: 250, clientY: 120 });

    // Tooltip is pinned
    const tooltip = container.querySelector('.runtime-chart-tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.getAttribute('data-pinned')).toBe('true');
    expect(point.classList.contains('is-pinned')).toBe(true);

    // Mouse leave should NOT hide the pinned tooltip
    fireEvent.mouseLeave(point);
    expect(container.querySelector('.runtime-chart-tooltip')).not.toBeNull();

    // Close button exists when pinned
    const closeBtn = screen.getByRole('button', { name: /close activity popup/i });
    expect(closeBtn).toBeInTheDocument();

    // Click on a tool call button to open detail activity
    const diffBtn = screen.getByRole('button', { name: 'git_diff' });
    fireEvent.click(diffBtn);

    // MCP activity details dialog should appear
    expect(await screen.findByText('MCP activity details')).toBeInTheDocument();
    expect(screen.getByText('Aevra Workspace')).toBeInTheDocument();
    expect(screen.getByText('diff content')).toBeInTheDocument();

    // Close the detail dialog
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    // Unpin using close button
    fireEvent.click(closeBtn);
    expect(container.querySelector('.runtime-chart-tooltip')).toBeNull();
    expect(point.classList.contains('is-pinned')).toBe(false);
  });

  test('pressing Escape unpins the tooltip', () => {
    const { container } = render(
      <DialogProvider>
        <RequestActivityChart data={createDashboardData()} />
      </DialogProvider>,
    );

    const points = container.querySelectorAll('.runtime-chart-point');
    const point = points[1] ?? points[0];

    // Click to pin
    fireEvent.click(point, { clientX: 250, clientY: 120 });
    expect(container.querySelector('.runtime-chart-tooltip')).not.toBeNull();

    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.runtime-chart-tooltip')).toBeNull();
  });
});
