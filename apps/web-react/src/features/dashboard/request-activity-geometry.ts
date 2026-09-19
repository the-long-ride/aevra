import type { McpActivityEntry } from '../../hooks/use-mcp-activity';

export interface RequestPoint {
  timestamp: number;
  active: number;
}

export const BASE_WIDTH = 720;
export const HEIGHT = 180;
export const LEFT = 14;
export const RIGHT = 4;
export const TOP = 12;
export const BOTTOM = 28;
export const DEFAULT_WINDOW_MS = 10 * 60_000;
export const MIN_WINDOW_MS = 30_000;
export const MAX_WINDOW_MS = 60 * 60_000;
export const FOLLOW_RESUME_MS = 10_000;
export const ZOOM_IN_FACTOR = 0.8;
export const ZOOM_OUT_FACTOR = 1.25;
const CORNER_RADIUS = 5;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Folds the activity log into a step series of concurrent-request counts by
 * replaying each entry's start as +1 and its completion as -1.
 */
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
  let lastEventTime = start;
  for (const event of events) {
    active = Math.max(0, active + event.delta);
    lastEventTime = event.timestamp;
    const previous = points[points.length - 1];
    if (previous?.timestamp === event.timestamp) previous.active = active;
    else points.push({ timestamp: event.timestamp, active });
  }

  // When active requests are running, extend to present (`end`).
  // When idle, cap trailing timeline to 30s after the last event so past requests
  // are cleanly visible instead of being squished by an endless flatline.
  const trailingPaddingMs = 30_000;
  const effectiveEnd =
    active > 0 || events.length === 0 ? end : Math.min(end, lastEventTime + trailingPaddingMs);

  if (points[points.length - 1]?.timestamp !== effectiveEnd) {
    points.push({ timestamp: effectiveEnd, active });
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

/**
 * Draws the step series with rounded corners, shrinking the radius on short
 * segments so a burst of near-simultaneous events cannot overshoot itself.
 */
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

/** Builds the flat step polyline the path renderer consumes. */
export function toStepPoints(
  points: RequestPoint[],
  x: (timestamp: number) => number,
  y: (active: number) => number,
): Array<[number, number]> {
  const stepPoints: Array<[number, number]> = [];
  points.forEach((point, index) => {
    const px = x(point.timestamp);
    const py = y(point.active);
    const previous = points[index - 1];
    if (previous) stepPoints.push([px, y(previous.active)]);
    stepPoints.push([px, py]);
  });
  return stepPoints;
}

export function activeEntriesAt(
  entries: McpActivityEntry[],
  timestamp: number,
): McpActivityEntry[] {
  return entries.filter((entry) => {
    if (entry.kind === 'session') return false;
    const entryStart = Date.parse(entry.startedAt);
    if (!Number.isFinite(entryStart) || entryStart > timestamp) return false;
    if (entry.state === 'running') return true;
    const entryEnd = Date.parse(entry.updatedAt);
    return !Number.isFinite(entryEnd) || entryEnd >= timestamp;
  });
}
