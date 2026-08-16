import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { DataTable } from './DataTable';

const rows = Array.from({ length: 30 }, (_, index) => ({
  id: String(index + 1),
  name: index === 0 ? 'Alpha' : `Row ${index + 1}`,
  state: index % 2 ? 'active' : 'idle',
  score: 30 - index,
}));

test('searches filters sorts and paginates rows', async () => {
  const user = userEvent.setup();
  render(
    <DataTable
      id="test-table"
      rows={rows}
      pageSize={10}
      searchPlaceholder="Search rows…"
      filters={[{ key: 'state', label: 'State' }]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'state', label: 'State' },
        { key: 'score', label: 'Score' },
      ]}
      rowKey={(row) => row.id}
    />,
  );

  expect(screen.getByText('1–10 of 30')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Score/ }));
  const stateFilter = screen
    .getAllByRole('button', { name: 'State' })
    .find((button) => button.getAttribute('aria-haspopup') === 'listbox');
  expect(stateFilter).toBeDefined();
  await user.click(stateFilter!);
  await user.click(screen.getByRole('option', { name: 'active' }));
  expect(screen.getByText(/of 15/)).toBeInTheDocument();
  await user.clear(screen.getByPlaceholderText('Search rows…'));
  await user.type(screen.getByPlaceholderText('Search rows…'), 'Alpha');
  expect(screen.queryByText('Row 2')).not.toBeInTheDocument();
  expect(screen.getByText('0 rows')).toBeInTheDocument();
});

test('changes page size and navigates between pages', async () => {
  const user = userEvent.setup();
  render(
    <DataTable
      id="test-pages"
      rows={rows}
      pageSize={10}
      columns={[{ key: 'name', label: 'Name' }]}
      rowKey={(row) => row.id}
    />,
  );
  expect(screen.getByText('Page 1 / 3')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '›' }));
  expect(screen.getByText('Page 2 / 3')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Rows per page' }));
  expect(screen.getByRole('option', { name: '5' })).toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: '5' }));
  expect(screen.getByText('Page 1 / 6')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Rows per page' }));
  await user.click(screen.getByRole('option', { name: '25' }));
  expect(screen.getByText('Page 1 / 2')).toBeInTheDocument();
});

test('formats datetime columns using the browser local device time', () => {
  const local = vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('LOCAL DEVICE TIME');
  render(
    <DataTable
      id="test-datetime"
      rows={[{ id: '1', createdAt: '2026-08-21T00:00:00.000Z' }]}
      columns={[{ key: 'createdAt', label: 'Created', dateTime: true }]}
      rowKey={(row) => row.id}
    />,
  );

  expect(screen.getByText('LOCAL DEVICE TIME')).toBeInTheDocument();
  expect(local).toHaveBeenCalled();
  local.mockRestore();
});

test('renders empty tables custom cells and non-sortable headers', () => {
  render(
    <DataTable
      id="test-empty"
      rows={[]}
      emptyText="Nothing here"
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'actions', label: 'Actions', sortable: false },
      ]}
    />,
  );

  // Non-sortable columns stay plain text without a sort button.
  expect(screen.queryByRole('button', { name: /Actions/ })).not.toBeInTheDocument();
  expect(screen.getByText('Nothing here')).toBeInTheDocument();
  expect(screen.getByText('0 rows')).toBeInTheDocument();
});

test('supports value accessors custom renderers filters and descending sort', async () => {
  const user = userEvent.setup();
  const data = [
    { id: 'a', size: null, tag: 'zeta', hidden: 'secret-a' },
    { id: 'b', size: 2, tag: 'alpha', hidden: 'secret-b' },
    { id: 'c', size: 10, tag: 'mike', hidden: 'secret-c' },
  ];
  render(
    <DataTable
      id="test-accessors"
      rows={data}
      defaultSort={{ key: 'size', direction: 'desc' }}
      pageSize={5}
      filters={[
        {
          key: 'tag',
          label: 'Tag',
          value: (row) => row.tag,
          format: (value) => `tag:${String(value)}`,
        },
      ]}
      columns={[
        { key: 'id', label: 'ID' },
        { key: 'size', label: 'Size' },
        { key: 'pretty', label: 'Pretty', value: (row) => row.tag.toUpperCase(), search: false },
        { key: 'cell', label: 'Cell', render: (row) => `cell-${row.id}` },
        { key: 'hidden', label: 'Hidden', search: false },
        { key: 'locked', label: 'Locked', sortable: false },
      ]}
      rowKey={(row) => row.id}
    />,
  );

  // Descending numeric default sort puts the only large number first; nulls sink last.
  const body = screen.getByRole('table');
  expect(body).toHaveTextContent('cell-c');
  expect(body).toHaveTextContent('cell-b');

  // The formatted filter option comes from format(); selecting it filters rows.
  await user.click(screen.getAllByRole('button', { name: 'Tag' })[0]!);
  await user.click(screen.getByRole('option', { name: 'tag:mike' }));
  expect(screen.getByText('1–1 of 1')).toBeInTheDocument();

  // Searching only matches searchable columns, never the pretty or hidden ones.
  await user.click(screen.getAllByRole('button', { name: 'Tag' })[0]!);
  await user.click(screen.getByRole('option', { name: 'All' }));
  await user.type(screen.getByPlaceholderText('Search…'), 'secret-b');
  expect(screen.getByText('0 rows')).toBeInTheDocument();
  await user.clear(screen.getByPlaceholderText('Search…'));
  await user.type(screen.getByPlaceholderText('Search…'), 'b');
  expect(screen.getByText('1–1 of 1')).toBeInTheDocument();
});

test('sort arrows flip direction and jump buttons reach both ends', async () => {
  const user = userEvent.setup();
  render(
    <DataTable
      id="test-jump"
      rows={rows}
      pageSize={5}
      columns={[{ key: 'name', label: 'Name' }]}
      rowKey={(row) => row.id}
    />,
  );

  const sortButton = screen.getByRole('button', { name: /Name/ });
  await user.click(sortButton);
  await user.click(sortButton);
  expect(screen.getByRole('button', { name: /Name ↓/ })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '»' }));
  expect(screen.getByText('Page 6 / 6')).toBeInTheDocument();
  expect(screen.getByText('26–30 of 30')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '«' }));
  expect(screen.getByText('Page 1 / 6')).toBeInTheDocument();
});
