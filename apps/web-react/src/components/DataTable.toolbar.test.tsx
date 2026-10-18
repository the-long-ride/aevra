import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { DataTable } from './DataTable';

const rows = [{ id: '1', name: 'Alpha', state: 'idle' }];
const columns = [{ key: 'name', label: 'Name' }];

test('toolbarActions render inside the control strip at its end', () => {
  const { container } = render(
    <DataTable
      id="actions-table"
      rows={rows}
      columns={columns}
      filters={[{ key: 'state', label: 'State' }]}
      toolbarActions={<button type="button">Extra action</button>}
    />,
  );
  const strip = container.querySelector('.dt-control-strip');
  const wrapper = strip?.querySelector('.dt-toolbar-actions');
  expect(wrapper).not.toBeNull();
  expect(wrapper?.textContent).toBe('Extra action');
  expect(strip?.lastElementChild).toBe(wrapper);
  expect(container.querySelector('.dt-toolbar')?.contains(wrapper!)).toBe(true);
});

test('compact density adds the compact class and default does not', () => {
  const compact = render(<DataTable id="c" rows={rows} columns={columns} density="compact" />);
  expect(compact.container.querySelector('.data-table-host')).toHaveClass('dt-compact');
  compact.unmount();
  const normal = render(<DataTable id="n" rows={rows} columns={columns} />);
  expect(normal.container.querySelector('.data-table-host')).not.toHaveClass('dt-compact');
  expect(normal.container.querySelector('.dt-toolbar-actions')).toBeNull();
});
