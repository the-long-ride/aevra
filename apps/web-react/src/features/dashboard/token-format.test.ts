import { describe, expect, it } from 'vitest';
import { formatTokens, savedShare } from './token-format';

describe('formatTokens', () => {
  it('formats small, thousands and millions', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(-5)).toBe('0');
    expect(formatTokens(Number.NaN)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1000)).toBe('1k');
    expect(formatTokens(1150)).toBe('1.2k');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(12_345)).toBe('12k');
    expect(formatTokens(999_499)).toBe('999k');
    expect(formatTokens(999_500)).toBe('1M');
    expect(formatTokens(1_234_567)).toBe('1.2M');
    expect(formatTokens(25_000_000)).toBe('25M');
  });
});

describe('savedShare', () => {
  it('is the saved part of saved + output', () => {
    expect(savedShare(25, 75)).toBe(25);
    expect(savedShare(0, 0)).toBe(0);
    expect(savedShare(0, 10)).toBe(0);
    expect(savedShare(100, 0)).toBe(100);
  });

  it('never rounds up to 100 while output was still sent', () => {
    expect(savedShare(999, 1)).toBe(99);
  });

  it('ignores negative and non-finite inputs', () => {
    expect(savedShare(-5, 10)).toBe(0);
    expect(savedShare(10, -5)).toBe(100);
    expect(savedShare(Number.POSITIVE_INFINITY, 1)).toBe(0);
    expect(savedShare(Number.NaN, 1)).toBe(0);
  });
});
