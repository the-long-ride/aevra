import { useLayoutEffect, useState } from 'react';
import { nextTheme, resolveInitialTheme, type Theme } from './theme-state';

const STORAGE_KEY = 'aevra.ui.theme.v1';

function initialTheme(): Theme {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return resolveInitialTheme(stored, prefersDark);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return {
    theme,
    toggleTheme: () => setTheme((current) => nextTheme(current)),
  };
}
