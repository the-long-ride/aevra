import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useMcpActivityEntries, type McpActivityEntry } from '../../hooks/use-mcp-activity';
import type { DashboardData } from './dashboard-service';

interface RequestPoint {
  timestamp: number;
  active: number;
}

const BASE_WIDTH = 720;
const HEIGHT = 180;
const LEFT = 34;
const RIGHT = 12;
const TOP = 12;
const BOTTOM = 28;
const DEFAULT_WINDOW_MS = 10 * 60_000;
const MIN_WINDOW_MS = 30_000;
const MAX_WINDOW_MS = 60 * 60_000;
const FOLLOW_RESUME_MS = 10_000;
const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1.25;
const CORNER_RADIUS = 5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function buildRequestHistory(entries: McpActivityEntry[], generatedAt: string) {
  const parsedEnd = Date.parse(generatedAt);
  const end = Number.isFinite(parsedEnd) ? parsedEnd : Date.now();
  const starts = entries.map((entry) => Date.parse(entry.startedAt)).filter(Number.isFinite);
  const start = starts.length ? Math.min(...starts, end) : end;
  const events: Array<{ timestamp: number; delta: number }> = [];

  for (const entry of entries) {
    if (entry.kind === 'session') continue;
    const entryStart = Date.parse(entry.startedAt);
    if (Number.isFinite(entryStart) && entryStart >= start && entryStart <= end) {
      events.push({ timestamp: entryStart, delta: 1 });
    }
    if (entry.state !== 'running') {
      const entryEnd = Date.parse(entry.updatedAt);
      if (Number.isFinite(entryEnd) && entryEnd >= start && entryEnd <= end) {
        events.push({ timestamp: entryEnd, delta: -1 });
      }
    }
  }

  events.sort((a, b) => a.timestamp - b.timestamp || b.delta - a.delta);
  const points: RequestPoint[] = [{ timestamp: start, active: 0 }];
  let active = 0;
  for (const event of events) {
    active = Math.max(0, active + event.delta);
    const previous = points[points.length - 1];
    if (previous?.timestamp === event.timestamp) previous.active = active;
    else points.push({ timestamp: event.timestamp, active });
  }
  if (points[points.length - 1]?.timestamp !== end) {
    points.push({ timestamp: end, active });
  }
  return points;
}

function distance(left: [number, number], right: [number, number]) {
  return Math.hypot(right[0] - left[0], right[1] - left[1]);
}

function pointToward(
  point: [number, number],
  target: [number, number],
  amount: number,
): [number, number] {
  const total = distance(point, target);
  if (!total) return point;
  const ratio = amount / total;
  return [point[0] + (target[0] - point[0]) * ratio, point[1] + (target[1] - point[1]) * ratio];
}

export function roundedStepPath(stepPoints: Array<[number, number]>) {
  if (!stepPoints.length) return '';
  if (stepPoints.length === 1) {
    return `M ${stepPoints[0][0].toFixed(2)} ${stepPoints[0][1].toFixed(2)}`;
  }

  let path = `M ${stepPoints[0][0].toFixed(2)} ${stepPoints[0][1].toFixed(2)}`;
  for (let index = 1; index < stepPoints.length - 1; index += 1) {
    const previous = stepPoints[index - 1];
    const current = stepPoints[index];
    const next = stepPoints[index + 1];
    const radius = Math.min(
      CORNER_RADIUS,
      distance(previous, current) / 2,
      distance(current, next) / 2,
    );
    if (radius <= 0.01) {
      path += ` L ${current[0].toFixed(2)} ${current[1].toFixed(2)}`;
      continue;
    }
    const before = pointToward(current, previous, radius);
    const after = pointToward(current, next, radius);
    path += ` L ${before[0].toFixed(2)} ${before[1].toFixed(2)}`;
    path += ` Q ${current[0].toFixed(2)} ${current[1].toFixed(2)} ${after[0].toFixed(2)} ${after[1].toFixed(2)}`;
  }
  const last = stepPoints[stepPoints.length - 1];
  return `${path} L ${last[0].toFixed(2)} ${last[1].toFixed(2)}`;
}

export function RequestActivityChart({ data }: { data: DashboardData }) {
  const entries = useMcpActivityEntries();
  const snapshot = data.snapshot as typeof data.snapshot & {
    startedAt?: string;
    generatedAt?: string;
  };
  const generatedAt = snapshot.generatedAt ?? new Date().toISOString();
  const points = useMemo(() => buildRequestHistory(entries, generatedAt), [entries, generatedAt]);
  const [visibleWindowMs, setVisibleWindowMs] = useState(DEFAULT_WINDOW_MS);
  const [following, setFollowing] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingZoomAnchorRef = useRef<{
    historyRatio: number;
    viewportRatio: number;
  } | null>(null);

  const historyStart = points[0]?.timestamp ?? Date.now();
  const historyEnd = Math.max(
    points[points.length - 1]?.timestamp ?? historyStart,
    historyStart + 1,
  );
  const historyDuration = Math.max(1, historyEnd - historyStart);
  const widthScale = Math.max(1, historyDuration / visibleWindowMs);
  const width = BASE_WIDTH * widthScale;
  const maxActive = Math.max(1, ...points.map((point) => point.active));
  const x = (timestamp: number) =>
    LEFT + ((timestamp - historyStart) / historyDuration) * (width - LEFT - RIGHT);
  const y = (active: number) => TOP + ((maxActive - active) / maxActive) * (HEIGHT - TOP - BOTTOM);
  const stepPoints: Array<[number, number]> = [];
  points.forEach((point, index) => {
    const px = x(point.timestamp);
    const py = y(point.active);
    const previous = points[index - 1];
    if (previous) stepPoints.push([px, y(previous.active)]);
    stepPoints.push([px, py]);
  });
  const path = roundedStepPath(stepPoints);
  const current = points[points.length - 1]?.active ?? 0;

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
  }, [following, historyEnd, scrollToPresent, visibleWindowMs]);

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

    section.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      section.removeEventListener('wheel', onWheel);
    };
  }, [pauseFollow]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
        pauseFollow();
      }
    },
    [pauseFollow],
  );

  return (
    <section
      ref={sectionRef}
      className="runtime-request-chart"
      aria-label="Active requests over runtime"
    >
      <div className="runtime-request-chart-head">
        <div>
          <span>Request activity</span>
          <strong>{current} active now</strong>
        </div>
        <small>
          Recent activity · {following ? 'following present' : 'browsing history'}
          {' · '}Alt + wheel to zoom
        </small>
      </div>
      <div
        ref={viewportRef}
        className="runtime-request-chart-viewport"
        role="region"
        aria-label="Request activity timeline"
        tabIndex={0}
        data-following={following}
        data-window-ms={visibleWindowMs}
        onScroll={handleScroll}
        onPointerDown={pauseFollow}
        onKeyDown={handleKeyDown}
      >
        <div className="runtime-request-chart-canvas" style={{ width: `${widthScale * 100}%` }}>
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label="Active requests by timestamp"
          >
            <line
              x1={LEFT}
              y1={TOP}
              x2={LEFT}
              y2={HEIGHT - BOTTOM}
              className="runtime-chart-axis"
            />
            <line
              x1={LEFT}
              y1={HEIGHT - BOTTOM}
              x2={width - RIGHT}
              y2={HEIGHT - BOTTOM}
              className="runtime-chart-axis"
            />
            <line x1={LEFT} y1={TOP} x2={width - RIGHT} y2={TOP} className="runtime-chart-grid" />
            <path d={path} className="runtime-chart-line" fill="none" />
            <text x={LEFT} y={HEIGHT - 8} className="runtime-chart-label">
              {new Date(historyStart).toLocaleTimeString()}
            </text>
            <text x={width - RIGHT} y={HEIGHT - 8} textAnchor="end" className="runtime-chart-label">
              {new Date(historyEnd).toLocaleTimeString()}
            </text>
            <text x={LEFT + 5} y={TOP + 12} className="runtime-chart-label">
              {maxActive}
            </text>
            <text x={LEFT + 5} y={HEIGHT - BOTTOM - 5} className="runtime-chart-label">
              0
            </text>
          </svg>
        </div>
      </div>
    </section>
  );
}
