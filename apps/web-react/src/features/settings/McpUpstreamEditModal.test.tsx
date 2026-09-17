import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { McpUpstreamEditModal, type UpstreamDraft } from './McpUpstreamEditModal';

function mount(initial?: Partial<UpstreamDraft>) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <McpUpstreamEditModal
      initial={initial}
      submitting={false}
      error=""
      onClose={onClose}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onClose };
}

describe('McpUpstreamEditModal', () => {
  it('defaults to http and shows a URL', () => {
    mount();
    expect((screen.getByLabelText(/transport/i) as HTMLSelectElement).value).toBe('http');
    expect(screen.getByLabelText(/server url/i)).toBeTruthy();
    expect(screen.queryByLabelText(/command to run/i)).toBeNull();
  });
  it('switches to stdio fields', () => {
    mount();
    fireEvent.change(screen.getByLabelText(/transport/i), { target: { value: 'stdio' } });
    expect(screen.getByLabelText(/command to run/i)).toBeTruthy();
    expect(screen.getByLabelText(/arguments/i)).toBeTruthy();
    expect(screen.queryByLabelText(/server url/i)).toBeNull();
  });
  it('submits an http server with a secret reference', () => {
    const { onSubmit } = mount();
    fireEvent.change(screen.getByLabelText(/server name/i), { target: { value: 'github' } });
    fireEvent.change(screen.getByLabelText(/server url/i), {
      target: { value: 'https://mcp.example.com/mcp' },
    });
    fireEvent.change(screen.getByLabelText(/header name/i), { target: { value: 'Authorization' } });
    fireEvent.change(screen.getByLabelText(/secret reference/i), {
      target: { value: 'sr_github' },
    });
    fireEvent.change(screen.getByLabelText(/risk tier/i), { target: { value: 'HIGH' } });
    fireEvent.click(screen.getByRole('button', { name: /save server/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'github',
      transport: 'http',
      config: { url: 'https://mcp.example.com/mcp' },
      auth: { header: 'Authorization', secretRefId: 'sr_github' },
      risk: 'HIGH',
    });
  });
  it('submits stdio args and env reference', () => {
    const { onSubmit } = mount();
    fireEvent.change(screen.getByLabelText(/transport/i), { target: { value: 'stdio' } });
    fireEvent.change(screen.getByLabelText(/server name/i), { target: { value: 'local-fs' } });
    fireEvent.change(screen.getByLabelText(/command to run/i), { target: { value: 'node' } });
    fireEvent.change(screen.getByLabelText(/arguments/i), {
      target: { value: 'server.js --root /srv' },
    });
    fireEvent.change(screen.getByLabelText(/environment variable/i), {
      target: { value: 'GITHUB_TOKEN' },
    });
    fireEvent.change(screen.getByLabelText(/secret reference/i), { target: { value: 'sr_gh' } });
    fireEvent.click(screen.getByRole('button', { name: /save server/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'local-fs',
      transport: 'stdio',
      config: { command: 'node', args: ['server.js', '--root', '/srv'] },
      auth: { env: { GITHUB_TOKEN: 'sr_gh' } },
      risk: 'MEDIUM',
    });
  });
  it('omits auth with no reference and offers four tiers without a password field', () => {
    mount();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(
      Array.from((screen.getByLabelText(/risk tier/i) as HTMLSelectElement).options).map(
        (o) => o.value,
      ),
    ).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });
  it('prefills an existing server', () => {
    mount({
      name: 'github',
      transport: 'http',
      config: { url: 'https://mcp.example.com/mcp' },
      auth: { header: 'X-API-Key', secretRefId: 'sr_key' },
      risk: 'CRITICAL',
    });
    expect((screen.getByLabelText(/server name/i) as HTMLInputElement).value).toBe('github');
    expect((screen.getByLabelText(/header name/i) as HTMLInputElement).value).toBe('X-API-Key');
  });
});
