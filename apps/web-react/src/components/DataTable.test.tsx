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
