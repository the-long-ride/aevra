import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useCountdown } from '../../hooks/use-countdown';
import type { Theme } from '../../hooks/theme-state';
import { LoginPanel, type LoginCredentials } from './LoginPanel';

type AuthState = 'checking' | 'authenticated' | 'unauthenticated';

export interface AdminAuthGateProps {
  children: ReactNode;
  theme?: Theme;
  onToggleTheme?: () => void;
}

async function readSession(): Promise<boolean> {
  const response = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'same-origin',
  });
  if (!response.ok) return false;
  const value = (await response.json()) as { authenticated?: unknown };
  return value.authenticated === true;
}

function lockoutDeadline(response: Response): number | null {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : null;
}

async function loginErrorMessage(response: Response): Promise<string> {
  if (response.status === 401) return 'Invalid username or password';
  if (response.status === 429) return 'Too many login attempts. Try again later.';
  if (response.status === 503) return 'Admin authentication unavailable';

  let code = '';
  try {
    const body = (await response.json()) as {
      error?: string | { code?: unknown; message?: unknown };
    };
    if (body.error && typeof body.error === 'object' && typeof body.error.code === 'string') {
      code = body.error.code;
    }
  } catch {
    // Fall through to a safe generic message.
  }

  if (response.status === 403 && code === 'CSRF_REJECTED') {
    return 'Login origin is not trusted';
  }
  if (response.status === 400 && code === 'HTTPS_REQUIRED') {
    return 'Admin login requires HTTPS';
  }
  return 'Invalid credentials';
}

export function AdminAuthGate({ children, theme, onToggleTheme }: AdminAuthGateProps) {
  const [state, setState] = useState<AuthState>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const retryAfterSeconds = useCountdown(lockedUntil);

  const refresh = useCallback(async () => {
    setState((await readSession()) ? 'authenticated' : 'unauthenticated');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (lockedUntil === null || retryAfterSeconds > 0) return;
    setLockedUntil(null);
    setError(null);
  }, [lockedUntil, retryAfterSeconds]);

  const login = async (credentials: LoginCredentials) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      if (!response.ok) {
        if (response.status === 429) setLockedUntil(lockoutDeadline(response));
        setError(await loginErrorMessage(response));
        return;
      }
      if (await readSession()) {
        setState('authenticated');
        return;
      }
      setError('Invalid credentials');
    } catch {
      setError('Unable to reach Aevra');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'checking') {
    return (
      <main className="admin-login" data-testid="admin-auth-checking">
        <section className="panel admin-login-panel">
          <p>Checking admin session…</p>
        </section>
      </main>
    );
  }

  if (state === 'unauthenticated') {
    return (
      <LoginPanel
        busy={busy}
        error={error}
        retryAfterSeconds={retryAfterSeconds}
        onSubmit={login}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
    );
  }

  return children;
}
