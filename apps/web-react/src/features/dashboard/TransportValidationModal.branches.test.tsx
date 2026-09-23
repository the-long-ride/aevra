import { render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { TransportValidationModal } from './TransportValidationModal';

const endpoint = (url: string, protocol: 'http' | 'https', loopback: boolean) => ({
  url,
  protocol,
  encrypted: protocol === 'https',
  loopback,
});

test('invalid transport warns, flags exposed listeners and lists every issue', () => {
  const transport = {
    state: 'invalid',
    summary: 'Admin is reachable over plain HTTP from the network.',
    gateway: endpoint('http://0.0.0.0:47830', 'http', false),
    admin: endpoint('http://0.0.0.0:47831', 'http', false),
    mcp: endpoint('https://localhost:47832', 'https', true),
    public: { url: 'ftp://aevra.example.com', encrypted: false },
    issues: ['Admin listener is not encrypted', 'Gateway is bound to every interface'],
  } as any;

  render(<TransportValidationModal open transport={transport} onClose={vi.fn()} />);

  const dialog = screen.getByRole('dialog', { name: 'Transport validation' });
  expect(within(dialog).getByText(/reachable over plain HTTP/)).toHaveClass('warning');
  expect(within(dialog).getAllByText('Network exposed')).toHaveLength(2);
  expect(within(dialog).getByText('Loopback')).toHaveClass('good');
  expect(within(dialog).getByText('Public exposure')).toBeInTheDocument();
  expect(within(dialog).getByText('Invalid')).toHaveClass('warn');
  const issues = within(dialog).getAllByRole('listitem');
  expect(issues.map((item) => item.textContent)).toEqual([
    'Admin listener is not encrypted',
    'Gateway is bound to every interface',
  ]);
});

test('transport without public exposure or issues omits both sections', () => {
  const transport = {
    state: 'local-https',
    summary: 'All listeners use HTTPS.',
    gateway: endpoint('https://127.0.0.1:47830', 'https', true),
    admin: endpoint('https://localhost:47831', 'https', true),
    mcp: endpoint('https://localhost:47832', 'https', true),
    public: {},
  } as any;

  render(<TransportValidationModal open transport={transport} onClose={vi.fn()} />);

  const dialog = screen.getByRole('dialog', { name: 'Transport validation' });
  expect(within(dialog).getByText('All listeners use HTTPS.')).toHaveClass('section-note');
  expect(within(dialog).queryByText('Public exposure')).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();
});
