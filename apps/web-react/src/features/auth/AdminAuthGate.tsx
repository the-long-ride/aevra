import { useCallback, useEffect, useState, type ReactNode } from 'react';
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

export function AdminAuthGate({ children, theme, onToggleTheme }: AdminAuthGateProps) {
  const [state, setState] = useState<AuthState>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState((await readSession()) ? 'authenticated' : 'unauthenticated');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
        setError(
          response.status === 429
            ? 'Too many login attempts. Try again later.'
            : 'Invalid credentials',
        );
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
        onSubmit={login}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
    );
  }

  return children;
}
