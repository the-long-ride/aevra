import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { DashboardPage } from './DashboardPage';

test('Runtime overview shows operational metrics without duplicating Version', async () => {
  installApiFixtures();
  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );

  expect(await screen.findByText('Remote sessions')).toBeInTheDocument();
  expect(screen.getByText('Workspace leases')).toBeInTheDocument();
  expect(screen.getByText('Pending requests')).toBeInTheDocument();
  expect(screen.queryByText('Version')).not.toBeInTheDocument();
});

test('Active connections marks YOLO sessions and explains immutable approvals', async () => {
  installApiFixtures({
    routes: {
      '/api/dashboard/runtime': {
        status: { version: '0.1.0' },
        uptimeSeconds: 100,
        pending: { total: 0 },
        stats: {
          sessions: 1,
          workspaceLeases: 1,
          processes: 0,
          openChanges: 0,
          toolCalls: 3,
          avgToolLatencyMs: 10,
          connectors: 1,
        },
        metrics: [],
        activeConnections: [
          {
            client: 'ChatGPT',
            authType: 'OAuth',
            workspace: 'Aevra',
            status: 'active',
            capabilities: ['files.read'],
            yolo: true,
            lastActivityAt: '2026-08-19T00:00:00Z',
          },
        ],
        connectors: [],
      },
    },
  });
  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );

  expect(await screen.findByText('YOLO')).toBeInTheDocument();
  expect(
    screen.getByText(/YOLO enabled.*immutable security approvals still require confirmation/),
  ).toBeInTheDocument();
});

test('Runtime overview shows sleep inhibition state and reason', async () => {
  installApiFixtures({
    routes: {
      '/api/dashboard/runtime': {
        status: { version: '0.1.0' },
        uptimeSeconds: 100,
        pending: { total: 0 },
        stats: {
          sessions: 1,
          workspaceLeases: 1,
          processes: 0,
          openChanges: 0,
          toolCalls: 0,
          avgToolLatencyMs: null,
          connectors: 0,
        },
        power: {
          mode: 'remote-connections',
          active: true,
          supported: true,
          platform: 'win32',
          reason: '1 remote connection',
          remoteConnections: 1,
          managedProcesses: 0,
        },
        metrics: [],
        activeConnections: [],
        connectors: [],
      },
    },
  });
  render(
    <DialogProvider>
      <DashboardPage />
    </DialogProvider>,
  );

  const sleepLabel = await screen.findByText('Sleep inhibition');
  expect(sleepLabel.closest('.runtime-stat')).toHaveClass('runtime-stat-compact');
  expect(screen.getByText(/Active.*1 remote connection/)).toHaveClass('runtime-stat-detail');
});
