import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { WelcomeModal } from './WelcomeModal';

const TOOLS = '/api/system/tunnel-tools';

function tools(cloudflared: boolean, ngrok: boolean, recommended: string | null) {
  return {
    cloudflared: cloudflared ? { available: true, version: '2026.5.2' } : { available: false },
    ngrok: ngrok ? { available: true, version: '3.22.1' } : { available: false },
    recommended,
  };
}

function renderModal(value: unknown) {
  installApiFixtures({ routes: { [TOOLS]: value } });
  const onClose = vi.fn();
  render(<WelcomeModal onClose={onClose} />);
  return onClose;
}

function row(id: 'cloudflared' | 'ngrok') {
  return document.querySelector<HTMLElement>(`[data-surface-id="welcome:tunnel-${id}"]`)!;
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/dashboard');
});

test('greets the user in a labelled dialog with the Guide tip', async () => {
  renderModal(tools(true, true, 'cloudflared'));
  const dialog = screen.getByRole('dialog', { name: 'Hi, welcome to Aevra' });
  expect(dialog).toHaveAttribute('data-surface-id', 'welcome:dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(within(dialog).getByText(/with your approval/i)).toBeInTheDocument();
  expect(within(dialog).getByText('Guide', { selector: 'b' })).toBeInTheDocument();
  expect(within(dialog).getByText('Copy prompt', { selector: 'b' })).toBeInTheDocument();
  expect(screen.getByText('Checking this device…')).toBeInTheDocument();
  await screen.findByText(/We'll use Cloudflare Tunnel/);
});

test('recommends Cloudflare Tunnel when both tools are ready', async () => {
  renderModal(tools(true, true, 'cloudflared'));
  expect(await screen.findByText(/We'll use Cloudflare Tunnel; it's ready/)).toBeInTheDocument();
  expect(within(row('cloudflared')).getByText('Ready')).toBeInTheDocument();
  expect(within(row('ngrok')).getByText('Ready')).toBeInTheDocument();
});

test('recommends whichever single tool is ready', async () => {
  renderModal(tools(false, true, 'ngrok'));
  expect(await screen.findByText(/We'll use ngrok; it's ready/)).toBeInTheDocument();
  expect(within(row('cloudflared')).getByText('Not found')).toBeInTheDocument();
  expect(within(row('ngrok')).getByText('Ready')).toBeInTheDocument();
});

test('recommends Cloudflare Tunnel when only cloudflared is ready', async () => {
  renderModal(tools(true, false, 'cloudflared'));
  expect(await screen.findByText(/We'll use Cloudflare Tunnel; it's ready/)).toBeInTheDocument();
  expect(within(row('ngrok')).getByText('Not found')).toBeInTheDocument();
});

test('suggests installing a tunnel tool when none is found', async () => {
  renderModal(tools(false, false, null));
  expect(await screen.findByText(/recommended, free/)).toBeInTheDocument();
  expect(screen.getByText(/optional/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Get cloudflared/ })).toHaveAttribute(
    'href',
    'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
  );
  expect(screen.getByRole('link', { name: /Get ngrok/ })).toHaveAttribute(
    'href',
    'https://ngrok.com/download',
  );
});

test('shows a gentle message when the check fails', async () => {
  renderModal(new Response('{}', { status: 503 }));
  expect(await screen.findByText(/Couldn't check right now/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: "Let's set up remote access" })).toBeEnabled();
});

test('X, Escape, backdrop, and the primary button all close the modal', async () => {
  const user = userEvent.setup();
  const onClose = renderModal(tools(true, true, 'cloudflared'));
  await screen.findByText(/We'll use Cloudflare Tunnel/);

  const close = screen.getByRole('button', { name: 'Close' });
  expect(close).toHaveAttribute('data-surface-id', 'welcome:close');
  await user.click(close);
  await user.keyboard('{Escape}');
  const primary = screen.getByRole('button', { name: "Let's set up remote access" });
  expect(primary).toHaveAttribute('data-surface-id', 'welcome:primary');
  await user.click(primary);
  await user.pointer({
    keys: '[MouseLeft]',
    target: document.querySelector('.modal-backdrop') as HTMLElement,
  });
  expect(onClose).toHaveBeenCalledTimes(4);
});
