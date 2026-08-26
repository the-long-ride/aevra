import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { AdminAuthGate } from './AdminAuthGate';

function renderGate() {
  return render(
    <AdminAuthGate>
      <p>Secured content</p>
    </AdminAuthGate>,
  );
}

async function submitCredentials(username = 'admin', password = 'hunter2') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Username'), username);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

test('renders children once the admin session is authenticated', async () => {
  installApiFixtures({ onboardingCompleted: true });
  renderGate();
  expect(await screen.findByText('Secured content')).toBeInTheDocument();
});

test('asks for credentials when no session exists and reports invalid logins', async () => {
  installApiFixtures({
    routes: { '/api/auth/session': { authenticated: false } },
    mutationResponses: {
      'POST /api/auth/login': new Response(JSON.stringify({}), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    },
  });
  renderGate();

  expect(await screen.findByTestId('admin-login')).toBeInTheDocument();
  await submitCredentials();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Invalid username or password');
  expect(screen.queryByText('Secured content')).not.toBeInTheDocument();
});

test.each([
  [
    403,
    {
      error: {
        code: 'CSRF_REJECTED',
        message: 'State-changing admin requests must be same-origin',
      },
    },
    'Login origin is not trusted',
  ],
  [
    400,
    { error: { code: 'HTTPS_REQUIRED', message: 'Admin login requires HTTPS' } },
    'Admin login requires HTTPS',
  ],
  [503, { error: 'Admin authentication unavailable' }, 'Admin authentication unavailable'],
])('shows a safe login error for HTTP %s', async (status, body, expected) => {
  installApiFixtures({
    routes: { '/api/auth/session': { authenticated: false } },
    mutationResponses: {
      'POST /api/auth/login': new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    },
  });
  renderGate();

  await screen.findByTestId('admin-login');
  await submitCredentials();
  expect(await screen.findByRole('alert')).toHaveTextContent(expected);
});

test('explains rate limiting when login attempts are throttled', async () => {
  installApiFixtures({
    routes: { '/api/auth/session': { authenticated: false } },
    mutationResponses: {
      'POST /api/auth/login': new Response(JSON.stringify({}), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    },
  });
  renderGate();

  await screen.findByTestId('admin-login');
  await submitCredentials();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Too many login attempts. Try again later.',
  );
});

test('rejects logins when the session recheck after a successful login fails', async () => {
  installApiFixtures({
    routes: { '/api/auth/session': { authenticated: false } },
  });
  renderGate();

  await screen.findByTestId('admin-login');
  await submitCredentials();
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
});

test('reports an unreachable backend when the login request itself fails', async () => {
  const fetchMock = installApiFixtures({
    routes: { '/api/auth/session': { authenticated: false } },
  });
  renderGate();

  await screen.findByTestId('admin-login');
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  await submitCredentials();
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach Aevra');
});
