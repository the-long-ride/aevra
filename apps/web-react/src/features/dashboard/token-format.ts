function scaled(n: number, unit: number, suffix: string): string {
  const whole = n / unit;
  // Round on the integer side so 1150 gives 1.2k rather than a float artefact.
  const text = whole < 10 ? String(Math.round(n / (unit / 10)) / 10) : String(Math.round(whole));
  return `${text}${suffix}`;
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 999_500) return scaled(n, 1000, 'k');
  return scaled(n, 1_000_000, 'M');
}

export function savedShare(saved: number, out: number): number {
  const total = saved + out;
  return total > 0 ? Math.round((saved / total) * 100) : 0;
}
