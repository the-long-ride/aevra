import { formatCountdown } from '../../hooks/use-countdown';
import { nextTheme, type Theme } from '../../hooks/theme-state';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface LoginPanelProps {
  busy: boolean;
  error: string | null;
  /** Seconds until sign-in unlocks after a lockout; sign-in is disabled while positive. */
  retryAfterSeconds?: number;
  onSubmit(credentials: LoginCredentials): Promise<void>;
  theme?: Theme;
  onToggleTheme?: () => void;
}

export function LoginPanel({
  busy,
  error,
  retryAfterSeconds = 0,
  onSubmit,
  theme,
  onToggleTheme,
}: LoginPanelProps) {
  const targetTheme = theme ? nextTheme(theme) : 'dark';
  const locked = retryAfterSeconds > 0;

  return (
    <main className="admin-login" data-testid="admin-login">
      {theme && onToggleTheme ? (
        <div className="admin-login-theme">
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={`Switch to ${targetTheme} mode`}
          >
            [{theme}]
          </button>
        </div>
      ) : null}
      <section className="panel admin-login-panel" aria-labelledby="admin-login-title">
        <div className="admin-login-brand">
          <img src="/aevra-logo.png" alt="" aria-hidden="true" />
          <div>
            <h1 id="admin-login-title">Sign in to Aevra</h1>
            <p>Authenticate to open the administration console.</p>
          </div>
        </div>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (locked) return;
            const form = new FormData(event.currentTarget);
            void onSubmit({
              username: String(form.get('username') ?? ''),
              password: String(form.get('password') ?? ''),
            });
          }}
        >
          <label className="field">
            <span>Username</span>
            <input name="username" type="text" autoComplete="username" required disabled={busy} />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </label>
          {error ? (
            <p className="warning" role="alert">
              {error}
            </p>
          ) : null}
          {locked ? (
            <p className="warning" role="timer">
              Try again in {formatCountdown(retryAfterSeconds)}
            </p>
          ) : null}
          <button type="submit" className="primary" disabled={busy || locked}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
