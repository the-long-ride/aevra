import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { useTheme } from './use-theme';

function Probe() {
  const { theme, toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>{theme}</button>;
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test('uses stored theme and persists toggles on the document root', async () => {
  window.localStorage.setItem('aevra.ui.theme.v1', 'light');
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  const user = userEvent.setup();
  render(<Probe />);

  expect(screen.getByRole('button')).toHaveTextContent('light');
  expect(document.documentElement.dataset.theme).toBe('light');
  await user.click(screen.getByRole('button'));
  expect(screen.getByRole('button')).toHaveTextContent('dark');
  expect(window.localStorage.getItem('aevra.ui.theme.v1')).toBe('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
});

test('uses operating-system dark mode when no stored preference exists', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  render(<Probe />);
  expect(screen.getByRole('button')).toHaveTextContent('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
});
