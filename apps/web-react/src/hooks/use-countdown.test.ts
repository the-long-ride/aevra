import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { formatCountdown, useCountdown } from './use-countdown';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('counts down once a second and stops its timer at zero', () => {
  const until = Date.now() + 3000;
  const { result } = renderHook(() => useCountdown(until));
  expect(result.current).toBe(3);

  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe(2);
  act(() => vi.advanceTimersByTime(2000));
  expect(result.current).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test('reports zero and runs no timer without a deadline', () => {
  const { result } = renderHook(() => useCountdown(null));
  expect(result.current).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test('restarts when given a new deadline', () => {
  const { result, rerender } = renderHook(({ until }) => useCountdown(until), {
    initialProps: { until: null as number | null },
  });
  expect(result.current).toBe(0);

  rerender({ until: Date.now() + 5000 });
  expect(result.current).toBe(5);
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe(4);
});

test.each([
  [0, '0s'],
  [45, '45s'],
  [60, '1m 00s'],
  [75, '1m 15s'],
  [3599, '59m 59s'],
  [3600, '1h 00m'],
])('formats %i seconds as %s', (seconds, expected) => {
  expect(formatCountdown(seconds)).toBe(expected);
});
