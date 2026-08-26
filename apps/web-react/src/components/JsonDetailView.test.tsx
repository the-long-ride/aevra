import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { JsonDetailView } from './JsonDetailView';

function installClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

test('renders valid JSON as an expandable tree and copies the exact sanitized payload', async () => {
  const user = userEvent.setup();
  const writeText = installClipboard();
  const value =
    '{\n  "path": "README.md",\n  "nested": { "count": 2 },\n  "items": [true, null]\n}';

  render(<JsonDetailView label="Input" value={value} emptyText="No input recorded." />);

  expect(screen.getByTestId('json-detail-tree')).toBeInTheDocument();
  expect(screen.getByText('README.md')).toBeInTheDocument();
  expect(screen.getByText('count')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Collapse nested' }));
  expect(screen.queryByText('count')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Expand nested' }));
  expect(screen.getByText('count')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Copy Input JSON' }));
  expect(writeText).toHaveBeenCalledWith(value);
  expect(screen.getByText('Copied')).toBeInTheDocument();
});

test('falls back to preformatted text when the payload is not JSON', () => {
  render(
    <JsonDetailView
      label="Output"
      value={'plain output\nwith another line'}
      emptyText="No output recorded."
    />,
  );

  expect(screen.queryByTestId('json-detail-tree')).not.toBeInTheDocument();
  expect(screen.getByTestId('json-detail-raw')).toHaveTextContent('plain output');
  expect(screen.getByText('TEXT')).toBeInTheDocument();
});

test('renders the supplied empty message when no payload exists', () => {
  render(<JsonDetailView label="Input" emptyText="No input recorded." />);
  expect(screen.getByText('No input recorded.')).toBeInTheDocument();
});
