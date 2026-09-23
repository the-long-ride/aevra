import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { JsonDetailView } from './JsonDetailView';

test('renders JSON encoded inside a string as a nested tree', () => {
  const value = JSON.stringify({ text: JSON.stringify({ exitCode: 0 }) });
  render(<JsonDetailView label="Output" value={value} emptyText="None" />);
  expect(screen.getByText('exitCode')).toBeInTheDocument();
  expect(screen.getByText('0')).toBeInTheDocument();
});

test('renders multi-line strings as a clamped block that can be expanded', async () => {
  const user = userEvent.setup();
  const body = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join('\n');
  render(<JsonDetailView label="Output" value={JSON.stringify({ body })} emptyText="None" />);

  const block = screen.getByTestId('json-detail-multiline');
  expect(block).toHaveTextContent('line 12');
  expect(block).not.toHaveTextContent('line 13');
  await user.click(screen.getByRole('button', { name: 'Show all 15 lines' }));
  expect(screen.getByTestId('json-detail-multiline')).toHaveTextContent('line 15');
});

test('collapses values nested deeper than two levels by default', () => {
  const value = JSON.stringify({ a: { b: { c: { d: 'deep' } } } });
  render(<JsonDetailView label="Input" value={value} emptyText="None" />);
  expect(screen.getByText('c')).toBeInTheDocument();
  expect(screen.queryByText('deep')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Expand c' })).toBeInTheDocument();
});

test('copies copyValue when one is supplied instead of the displayed value', async () => {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<JsonDetailView label="Output" value='{"a":1}' copyValue="original" emptyText="None" />);
  await user.click(screen.getByRole('button', { name: 'Copy Output JSON' }));
  expect(writeText).toHaveBeenCalledWith('original');
});

test('raw format shows the exact text even when it is JSON', () => {
  render(<JsonDetailView label="Input" value='{"a":1}' format="raw" emptyText="None" />);
  expect(screen.queryByTestId('json-detail-tree')).not.toBeInTheDocument();
  expect(screen.getByTestId('json-detail-raw')).toHaveTextContent('{"a":1}');
  expect(screen.getByText('RAW')).toBeInTheDocument();
});
