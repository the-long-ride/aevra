import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { McpDiagnosticsNotice } from './McpDiagnosticsNotice';

test('renders nothing without a snapshot or with an unknown hint', () => {
  const { container: empty, rerender } = render(<McpDiagnosticsNotice />);
  expect(empty).toBeEmptyDOMElement();

  rerender(<McpDiagnosticsNotice snapshot={null} />);
  expect(empty).toBeEmptyDOMElement();

  rerender(<McpDiagnosticsNotice snapshot={{ hint: 'unexpected' } as never} />);
  expect(screen.queryByRole('status')).toBeNull();
});

test('explains missing client traffic', () => {
  render(<McpDiagnosticsNotice snapshot={{ hint: 'no-client-traffic' } as never} />);
  expect(screen.getByRole('status').textContent).toContain('no MCP request has reached');
});

test('explains traffic that never initialized a session', () => {
  render(<McpDiagnosticsNotice snapshot={{ hint: 'traffic-no-initialize' } as never} />);
  expect(screen.getByRole('status').textContent).toContain('no session initialized successfully');
});

test('reports successful initialization without tool calls', () => {
  render(<McpDiagnosticsNotice snapshot={{ hint: 'initialized-no-tools' } as never} />);
  expect(screen.getByRole('status').textContent).toContain('No tool call has reached Aevra yet.');
});
