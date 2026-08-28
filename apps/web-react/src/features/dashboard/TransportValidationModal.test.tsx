import { render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { TransportValidationModal } from './TransportValidationModal';

const httpTransport = {
  state: 'local-http',
  summary: 'HTTP is limited to the loopback gateway; Admin and MCP remain HTTPS.',
  gateway: {
    url: 'http://127.0.0.1:47830',
    protocol: 'http',
    encrypted: false,
    loopback: true,
  },
  admin: {
    url: 'https://localhost:47831',
    protocol: 'https',
    encrypted: true,
    loopback: true,
  },
  mcp: {
    url: 'https://localhost:47832',
    protocol: 'https',
    encrypted: true,
    loopback: true,
  },
  public: {
    url: 'https://aevra.example.com',
    protocol: 'https',
    encrypted: true,
  },
  issues: [],
} as any;

test('transport validation explains gateway-only HTTP and preserved HTTPS listeners', () => {
  render(<TransportValidationModal open transport={httpTransport} onClose={vi.fn()} />);

  const dialog = screen.getByRole('dialog', { name: 'Transport validation' });
  expect(within(dialog).getByText('Local gateway')).toBeInTheDocument();
  expect(within(dialog).getByText('http://127.0.0.1:47830')).toBeInTheDocument();
  expect(within(dialog).getByText('Admin')).toBeInTheDocument();
  expect(within(dialog).getByText('https://localhost:47831')).toBeInTheDocument();
  expect(within(dialog).getByText('MCP ingress')).toBeInTheDocument();
  expect(within(dialog).getByText('https://localhost:47832')).toBeInTheDocument();
  expect(within(dialog).getByText(/HTTP is limited to the loopback gateway/i)).toBeInTheDocument();
  expect(within(dialog).getAllByText('HTTPS').length).toBeGreaterThanOrEqual(2);
  expect(within(dialog).getByText('HTTP')).toBeInTheDocument();
});

test('transport validation stays usable when an older snapshot has no transport data', () => {
  render(<TransportValidationModal open onClose={vi.fn()} />);

  expect(
    screen.getByText('Transport validation is unavailable for this runtime snapshot.'),
  ).toBeInTheDocument();
});
