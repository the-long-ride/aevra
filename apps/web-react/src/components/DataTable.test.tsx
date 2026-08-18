import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
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
  await user.selectOptions(screen.getByLabelText('State'), 'active');
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
  await user.selectOptions(screen.getByLabelText('Rows'), '25');
  expect(screen.getByText('Page 1 / 2')).toBeInTheDocument();
});
