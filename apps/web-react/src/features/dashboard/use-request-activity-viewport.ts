import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  clamp,
  DEFAULT_WINDOW_MS,
  FOLLOW_RESUME_MS,
  MAX_WINDOW_MS,
  MIN_WINDOW_MS,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from './request-activity-geometry';

const SCROLL_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];

/**
 * Owns the pan/zoom/follow behaviour of the activity timeline.
 *
 * The chart follows the present until the reader interacts, then holds still
 * for a beat so a scroll or zoom is not yanked back by the next data tick.
 */
export function useRequestActivityViewport(historyStart: number, historyEnd: number) {
  const [visibleWindowMs, setVisibleWindowMs] = useState(DEFAULT_WINDOW_MS);
  const [following, setFollowing] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingZoomAnchorRef = useRef<{
    historyRatio: number;
    viewportRatio: number;
  } | null>(null);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const pauseFollow = useCallback(() => {
    setFollowing(false);
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      setFollowing(true);
    }, FOLLOW_RESUME_MS);
  }, [clearIdleTimer]);

  useEffect(() => clearIdleTimer, [clearIdleTimer]);

  const scrollToPresent = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    if (following) {
      pendingZoomAnchorRef.current = null;
      scrollToPresent();
      return;
    }

    // Keeps the point under the cursor fixed across a zoom, so the timeline
    // grows around what the reader is looking at rather than the left edge.
    const pendingAnchor = pendingZoomAnchorRef.current;
    if (!pendingAnchor) return;
    const nextLeft =
      pendingAnchor.historyRatio * viewport.scrollWidth -
      pendingAnchor.viewportRatio * viewport.clientWidth;
    viewport.scrollLeft = clamp(
      nextLeft,
      0,
      Math.max(0, viewport.scrollWidth - viewport.clientWidth),
    );
    pendingZoomAnchorRef.current = null;
  }, [following, historyEnd, historyStart, scrollToPresent, visibleWindowMs]);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    if (following && maxLeft - viewport.scrollLeft <= 2) return;
    pauseFollow();
  }, [following, pauseFollow]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const onWheel = (event: WheelEvent) => {
      const viewport = viewportRef.current;
      if (event.altKey) {
        event.preventDefault();
        pauseFollow();
        if (!viewport) return;
        const rect = viewport.getBoundingClientRect();
        const localX = rect.width > 0 ? clamp(event.clientX - rect.left, 0, rect.width) : 0;
        const viewportRatio = viewport.clientWidth > 0 ? localX / viewport.clientWidth : 0.5;
        const historyRatio =
          viewport.scrollWidth > 0
            ? clamp((viewport.scrollLeft + localX) / viewport.scrollWidth, 0, 1)
            : 1;
        pendingZoomAnchorRef.current = { historyRatio, viewportRatio };
        setVisibleWindowMs((currentWindow) =>
          clamp(
            currentWindow * (event.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR),
            MIN_WINDOW_MS,
            MAX_WINDOW_MS,
          ),
        );
        return;
      }

      if (!viewport || viewport.scrollWidth <= viewport.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      pauseFollow();
      viewport.scrollLeft = clamp(
        viewport.scrollLeft + delta,
        0,
        Math.max(0, viewport.scrollWidth - viewport.clientWidth),
      );
    };

    // Not passive: zooming and horizontal panning both need preventDefault.
    section.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      section.removeEventListener('wheel', onWheel);
    };
  }, [pauseFollow]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (SCROLL_KEYS.includes(event.key)) pauseFollow();
    },
    [pauseFollow],
  );

  return {
    sectionRef,
    viewportRef,
    following,
    visibleWindowMs,
    pauseFollow,
    handleScroll,
    handleKeyDown,
  };
}
