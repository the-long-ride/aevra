import { describe, expect, it } from 'vitest';
import { layoutBars, niceMax } from './token-usage-geometry';

describe('niceMax', () => {
  it('rounds up to 1, 2, 5 or 10 times a power of ten', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-4)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(600)).toBe(1000);
    expect(niceMax(4999)).toBe(5000);
  });
});

describe('layoutBars', () => {
  const plot = { width: 100, height: 50 };
  it('splits the width into slots and scales heights to the max', () => {
    const bars = layoutBars(
      [
        { inputTokens: 10, outputTokens: 30, savedTokens: 20 },
        { inputTokens: 0, outputTokens: 0, savedTokens: 0 },
      ],
      plot,
      100,
    );
    expect(bars).toHaveLength(2);
    expect(bars[0]!.inputH).toBeCloseTo(5);
    expect(bars[0]!.outputH).toBeCloseTo(15);
    expect(bars[0]!.savedY).toBeCloseTo(40);
    expect(bars[1]!.inputH).toBe(0);
    expect(bars[1]!.savedY).toBe(50);
    expect(bars[1]!.x).toBeGreaterThan(bars[0]!.x);
    expect(bars[0]!.width).toBeGreaterThanOrEqual(1);
    expect(bars[1]!.x + bars[1]!.width).toBeLessThanOrEqual(100);
  });

  it('returns no bars for an empty series', () => {
    expect(layoutBars([], plot, 1)).toEqual([]);
  });
});
