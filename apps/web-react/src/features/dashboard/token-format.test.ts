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
  });
});
