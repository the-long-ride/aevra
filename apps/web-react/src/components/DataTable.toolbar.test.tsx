import { readFileSync } from 'node:fs';
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

test('responsive toolbar allows filter and rows page size to share the same row on small viewports', () => {
  const css = readFileSync('src/styles/data-table.css', 'utf8');
  expect(css).toMatch(
    /@media\s*\(max-width:\s*760px\)[\s\S]*?\.dt-filters\s*\{[^}]*display:\s*contents/,
  );
  expect(css).toMatch(
    /@media\s*\(max-width:\s*760px\)[\s\S]*?\.dt-control-strip\s*\{[^}]*display:\s*flex/,
  );
  expect(css).toMatch(
    /@media\s*\(max-width:\s*760px\)[\s\S]*?\.dt-filter\s*\{[^}]*flex:\s*1\s+1\s+140px/,
  );
  expect(css).toMatch(
    /@media\s*\(max-width:\s*760px\)[\s\S]*?\.dt-size\s*\{[^}]*flex:\s*0\s+0\s+auto/,
  );
});
