import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { requestJson } from '../../services/api-client';
import { McpUpstreamsSettings, type UpstreamSummary } from './McpUpstreamsSettings';

vi.mock('../../services/api-client', () => ({ requestJson: vi.fn() }));

const mockedRequest = vi.mocked(requestJson);

function upstream(overrides: Partial<UpstreamSummary> = {}): UpstreamSummary {
  return {
    id: 'up 1',
    name: 'alpha',
    transport: 'http',
    config: { url: 'https://alpha.example.com/mcp' },
    auth: { kind: 'none' },
    risk: 'normal' as any,
    enabled: true,
    state: 'active',
    toolCount: 3,
    resourceCount: 0,
    promptCount: 0,
    pendingCatalogDiff: null,
    advisory: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

let rows: UpstreamSummary[] = [];
let responses: Record<string, unknown> = {};

function route(url: string, init?: RequestInit) {
  const key = `${init?.method ?? 'GET'} ${url}`;
  if (key in responses) {
    const value = responses[key];
    if (value instanceof Error || typeof value === 'string') return Promise.reject(value);
    return Promise.resolve(value);
  }
  if (key === 'GET /api/mcp/upstreams') return Promise.resolve({ upstreams: rows });
  return Promise.resolve({ ok: true });
}

function renderSettings() {
  return render(
    <DialogProvider>
      <McpUpstreamsSettings />
    </DialogProvider>,
  );
}

function calls(method: string, url: string) {
  return mockedRequest.mock.calls.filter(
    ([path, init]) => path === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  );
}

beforeEach(() => {
  rows = [upstream()];
  responses = {};
  mockedRequest.mockReset();
  mockedRequest.mockImplementation(route as never);
});

afterEach(() => {
  mockedRequest.mockReset();
});

describe('McpUpstreamsSettings default services', () => {
  it('tests a server through the default endpoint and shows unknown name fallbacks', async () => {
    responses['POST /api/mcp/upstreams/up%201/test'] = {
      ok: true,
      serverName: null,
      serverVersion: null,
      toolCount: 3,
    };
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Test alpha' }));
    await waitFor(() =>
      expect(document.querySelector('.inline-result')?.textContent).toMatch(/^unknown\s+\S 3 tools$/),
    );
  });

  it('shows the default failed-connection message when a test has no message', async () => {
    responses['POST /api/mcp/upstreams/up%201/test'] = { ok: false, message: null, toolCount: 0 };
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Test alpha' }));
    expect(await screen.findByText('The connection failed')).toBeInTheDocument();
  });

  it('stringifies non-Error failures from load and actions', async () => {
    responses['GET /api/mcp/upstreams'] = 'catalog offline';
    renderSettings();
    expect(await screen.findByRole('alert')).toHaveTextContent('catalog offline');
  });

  it('stringifies a non-Error action failure', async () => {
    responses['POST /api/mcp/upstreams/up%201/test'] = 'probe refused';
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Test alpha' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('probe refused');
  });

  it('removes through the default DELETE endpoint after confirmation', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove alpha' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove MCP server' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls('DELETE', '/api/mcp/upstreams/up%201')).toHaveLength(1));
  });

  it('acknowledges a catalog change through the default endpoint', async () => {
    rows = [
      upstream({
        state: 'needs-review',
        pendingCatalogDiff: { added: ['new_tool'], removed: [], changed: [] },
      }),
    ];
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge alpha' }));
    await waitFor(() =>
      expect(calls('POST', '/api/mcp/upstreams/up%201/acknowledge')).toHaveLength(1),
    );
  });

  it('updates an edited server through the default endpoint', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit alpha' }));
    fireEvent.click(screen.getByRole('button', { name: /save server/i }));
    await waitFor(() => expect(calls('POST', '/api/mcp/upstreams/up%201')).toHaveLength(1));
    const body = JSON.parse(String((calls('POST', '/api/mcp/upstreams/up%201')[0][1] as any).body));
    expect(body.name).toBe('alpha');
  });

  it('creates a server and shows a stringified form failure', async () => {
    responses['POST /api/mcp/upstreams'] = 'name taken';
    renderSettings();
    await screen.findByRole('row', { name: /alpha/ });
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByLabelText(/server name/i), { target: { value: 'beta' } });
    fireEvent.change(screen.getByLabelText(/server url/i), {
      target: { value: 'https://beta.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save server/i }));
    expect(await screen.findByText('name taken')).toBeInTheDocument();
    expect(calls('POST', '/api/mcp/upstreams')).toHaveLength(1);
  });
});

describe('McpUpstreamsSettings table values', () => {
  it('renders unknown states and stdio commands with or without args', async () => {
    rows = [
      upstream({ id: 'a', name: 'alpha', state: 'mystery' as any }),
      upstream({
        id: 'b',
        name: 'bravo',
        transport: 'stdio',
        config: { command: 'node', args: ['server.js', '--quiet'] },
        advisory: [{ tool: 'read_docs', readOnlyHint: true }, { tool: 'write_docs' }],
      }),
      upstream({ id: 'c', name: 'charlie', transport: 'stdio', config: { command: 'serve' } }),
    ];
    renderSettings();
    const alpha = await screen.findByRole('row', { name: /alpha/ });
    expect(within(alpha).getByText('mystery')).toBeInTheDocument();
    expect(screen.getByText('node server.js --quiet')).toBeInTheDocument();
    expect(screen.getByText('serve')).toBeInTheDocument();
    expect(screen.getByText(/read_docs: claims read-only/)).toBeInTheDocument();
    expect(screen.getByText(/write_docs: no read-only claim/)).toBeInTheDocument();

    const search = within(
      document.querySelector('[data-table-id="react-mcp-upstreams"]') as HTMLElement,
    ).getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'server.js' } });
    await waitFor(() => expect(screen.queryByRole('row', { name: /alpha/ })).toBeNull());
    expect(screen.getByRole('row', { name: /bravo/ })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    for (const label of ['Status', 'Risk', 'Tools', 'Transport']) {
      const header = screen.getAllByRole('columnheader').find((cell) =>
        cell.textContent?.includes(label),
      ) as HTMLElement;
      fireEvent.click(within(header).queryByRole('button') ?? header);
    }
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(4);
  });
});
