import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { AdminAuthGate } from './AdminAuthGate';

const plainPhrase1 = 'garden2';

function lockedLogin(retryAfter?: string) {
  installApiFixtures({
    routes: { '/api/auth/session': { authenticated: false } },
    mutationResponses: {
      'POST /api/auth/login': new Response(JSON.stringify({ error: 'Too many login attempts' }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          ...(retryAfter ? { 'retry-after': retryAfter } : {}),
        },
      }),
    },
  });
  render(
    <AdminAuthGate>
      <p>Secured content</p>
    </AdminAuthGate>,
  );
}

async function submitCredentials() {
  const user = userEvent.setup();
  await screen.findByTestId('admin-login');
  await user.type(screen.getByLabelText('Username'), 'admin');
  await user.type(screen.getByLabelText('Password'), plainPhrase1);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

test('a lockout shows an inline countdown from Retry-After and disables sign-in', async () => {
  lockedLogin('75');
  await submitCredentials();

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Too many login attempts. Try again later.',
  );
  expect(screen.getByRole('timer')).toHaveTextContent('Try again in 1m 15s');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
});

test('sign-in unlocks and the lockout message clears when the countdown ends', async () => {
  lockedLogin('1');
  await submitCredentials();
  expect(await screen.findByRole('timer')).toHaveTextContent('Try again in 1s');

  await waitFor(
    () => {
      expect(screen.queryByRole('timer')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    },
    { timeout: 3000 },
  );
});

test('a lockout without a usable Retry-After shows the message but no countdown', async () => {
  lockedLogin('soon');
  await submitCredentials();

  expect(await screen.findByRole('alert')).toHaveTextContent('Too many login attempts');
  expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});
