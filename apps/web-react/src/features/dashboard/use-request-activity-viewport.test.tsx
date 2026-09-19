import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WINDOW_MS, MIN_WINDOW_MS, ZOOM_IN_FACTOR } from './request-activity-geometry';
import { useRequestActivityViewport } from './use-request-activity-viewport';

describe('useRequestActivityViewport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('initializes in following state and resumes follow after timeout', () => {
    const { result } = renderHook(() => useRequestActivityViewport(0, 100_000));
    expect(result.current.following).toBe(true);
    expect(result.current.visibleWindowMs).toBe(DEFAULT_WINDOW_MS);

    act(() => {
      result.current.pauseFollow();
    });
    expect(result.current.following).toBe(false);

    // Fast forward idle timer
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.following).toBe(true);
  });

  it('pauses follow on keyboard navigation with scroll keys', () => {
    const { result } = renderHook(() => useRequestActivityViewport(0, 100_000));

    act(() => {
      result.current.handleKeyDown({ key: 'Enter' } as any);
    });
    expect(result.current.following).toBe(true);

    act(() => {
      result.current.handleKeyDown({ key: 'ArrowLeft' } as any);
    });
    expect(result.current.following).toBe(false);
  });

  it('attaches wheel listener to zoom with Alt and pan without Alt', () => {
    const { result } = renderHook(() => useRequestActivityViewport(0, 100_000));

    const section = document.createElement('section');
    const viewport = document.createElement('div');
    Object.defineProperty(viewport, 'clientWidth', { value: 500, configurable: true });
    Object.defineProperty(viewport, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(viewport, 'scrollLeft', { value: 400, writable: true });
    viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 500, height: 200, bottom: 200, right: 500 }) as DOMRect;

    (result.current.sectionRef as any).current = section;
    (result.current.viewportRef as any).current = viewport;

    // Trigger effect by dispatching wheel on section
    const wheelZoomEvent = new WheelEvent('wheel', {
      altKey: true,
      deltaY: -100,
      clientX: 250,
      bubbles: true,
      cancelable: true,
    });

    // Re-render to attach listener
    const hook = renderHook(() => {
      const v = useRequestActivityViewport(0, 100_000);
      (v.sectionRef as any).current = section;
      (v.viewportRef as any).current = viewport;
      return v;
    });

    // Zoom in with altKey
    act(() => {
      section.dispatchEvent(wheelZoomEvent);
    });
    expect(hook.result.current.following).toBe(false);

    // Horizontal wheel pan
    const wheelPanEvent = new WheelEvent('wheel', {
      altKey: false,
      deltaX: 50,
      deltaY: 0,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      section.dispatchEvent(wheelPanEvent);
    });
    expect(viewport.scrollLeft).toBeGreaterThanOrEqual(400);

    // handleScroll near end keeps following
    act(() => {
      viewport.scrollLeft = 500; // maxLeft = 500
      hook.result.current.handleScroll();
    });
  });
});
