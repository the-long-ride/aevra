import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { McpUpstreamsSettings } from './McpUpstreamsSettings';
import { McpUpstreamHintsModal } from './McpUpstreamDetails';

const row = {
  id: 'u1',
  name: 'docs',
  transport: 'stdio' as const,
  config: { command: 'node' },
  auth: { kind: 'none' },
  risk: 'HIGH' as const,
  enabled: false,
  state: 'needs-review' as const,
  toolCount: 3,
  resourceCount: 0,
  promptCount: 0,
  pendingCatalogDiff: null,
  advisory: [],
  createdAt: 'c',
  updatedAt: 'u',
  documentationSource: 'pending' as const,
  tools: [
    {
      name: 'read_docs',
      description: 'Read a document by path.',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: { path: { type: 'string', description: 'Document path' } },
        examples: [{ path: '/docs/readme.md' }],
      },
    },
    {
      name: 'search_docs',
      description: 'Find matching documents.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer', default: 10 } },
      },
    },
    { name: 'unannotated' },
  ],
};

test('opens documentation even when a server has no advisory flags', async () => {
  const user = userEvent.setup();
  render(
    <DialogProvider>
      <McpUpstreamsSettings load={async () => [row]} />
    </DialogProvider>,
  );
  await user.click(await screen.findByRole('button', { name: 'Detail for docs' }));
  const modal = screen.getByRole('dialog', { name: 'Detail — docs' });
  expect(modal).toHaveTextContent('Pending catalog');
  await user.click(within(modal).getByText('read_docs', { exact: true }));
  expect(within(modal).getByText('Read a document by path.')).toBeVisible();
  expect(within(modal).getByText('Document path')).toBeVisible();
  expect(within(modal).getByLabelText('Example arguments for read_docs')).toHaveTextContent(
    '/docs/readme.md',
  );
  expect(modal).toHaveTextContent('Server-provided example');
  expect(modal).toHaveTextContent('Required');
});

test('searches tool names and instructions, labels illustrative examples and missing documentation', async () => {
  const user = userEvent.setup();
  render(<McpUpstreamHintsModal row={row} onClose={() => {}} />);
  const search = screen.getByRole('searchbox', { name: 'Search tools' });
  await user.type(search, 'matching');
  expect(screen.queryByText('read_docs', { exact: true })).toBeNull();
  await user.click(screen.getByText('search_docs', { exact: true }));
  expect(screen.getByText(/Illustrative example/)).toBeVisible();
  expect(screen.getByLabelText('Example arguments for search_docs')).toHaveTextContent(
    '"limit": 10',
  );
  await user.clear(search);
  await user.type(search, 'unannotated');
  await user.click(screen.getByText('unannotated', { exact: true }));
  expect(screen.getByText('No instructions supplied by this server.')).toBeVisible();
  expect(screen.getByText('No input schema or example supplied.')).toBeVisible();
  await user.type(search, 'missing');
  expect(screen.getByText('No tools match your search.')).toBeVisible();
});

test('renders server instructions as text rather than executable markup', async () => {
  const malicious = {
    ...row,
    tools: [{ name: 'unsafe', description: '<img src=x onerror=alert(1)>' }],
  };
  render(<McpUpstreamHintsModal row={malicious} onClose={() => {}} />);
  fireEvent.click(screen.getByText('unsafe', { exact: true }));
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(screen.queryByRole('img')).toBeNull();
});
